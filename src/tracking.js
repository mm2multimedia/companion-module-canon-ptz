const { InstanceStatus } = require('@companion-module/base')
const axios = require('axios')

module.exports = {
	initTrackingPolling() {
		let self = this

		// Cleanup old interval
		if (self.pollTrackingTimer) {
			clearInterval(self.pollTrackingTimer)
		}

		// Only setup tracking polling if enabled AND cameras are configured
		if (self.config.enableTracking === true && self.configuredCameras && self.configuredCameras.length > 0) {
			self.log('debug', 'Starting tracking polling...')
			let pollAttempts = 0
			self.pollTrackingTimer = setInterval(() => {
				try {
					// Only poll if we have a selected camera
					if (self.currentSelectedCameraIndex !== null && self.currentSelectedCameraIndex !== undefined) {
						self.getCameraTrackingConfig.bind(self)(self.currentSelectedCameraIndex)
						self.getCameraTrackingInformation.bind(self)(self.currentSelectedCameraIndex)
						pollAttempts = 0 // Reset counter when polling succeeds
					} else {
						// Only log once per 10 attempts to avoid log spam
						if (pollAttempts % 10 === 0) {
							self.log('info', 'Auto Tracking polling waiting for camera selection...')
						}
						pollAttempts++
					}
				} catch (e) {
					self.log('warn', `Error in tracking poll: ${e.message}`)
				}
			}, self.config.trackingInterval || 250)
		}
	},

	stopTrackingPolling() {
		let self = this

		if (self.pollTrackingTimer) {
			clearInterval(self.pollTrackingTimer)
			delete self.pollTrackingTimer
		}
	},

	async sendTrackingRequest(cmd, cameraIndex) {
		let self = this

		// Get the camera to use for tracking
		if (!self.configuredCameras || self.configuredCameras.length === 0) {
			self.log('warn', 'No cameras configured for tracking request')
			return { status: 'failed' }
		}

		self.log('debug', `Configured cameras: ${self.configuredCameras.map(c => `${c.index}@${c.ip}`).join(', ')}`)
		self.log('debug', `sendTrackingRequest called with cameraIndex: ${cameraIndex}, currentSelectedCameraIndex: ${self.currentSelectedCameraIndex}`)

		let selectedCamera = null
		let cameraIndexToUse = null

		// Priority 1: Use provided camera index (resolve variables if needed)
		if (cameraIndex !== undefined && cameraIndex !== null) {
			try {
				const resolvedIndex = await self.parseVariablesInString(cameraIndex.toString())
				const parsedIndex = parseInt(resolvedIndex)
				self.log('debug', `Resolved camera index from '${cameraIndex}' → '${resolvedIndex}' → parsed: ${parsedIndex}`)
				if (!isNaN(parsedIndex) && parsedIndex > 0) {
					cameraIndexToUse = parsedIndex
					self.log('debug', `Tracking request using provided camera index: ${cameraIndexToUse}`)
				} else {
					self.log('warn', `Failed to resolve camera index from: '${cameraIndex}' (resolved to '${resolvedIndex}', parsed as ${parsedIndex})`)
				}
			} catch (e) {
				self.log('error', `Exception resolving camera index '${cameraIndex}': ${e.message}`)
			}
		}
		// Priority 2: Use currently selected camera
		else if (self.currentSelectedCameraIndex !== null && self.currentSelectedCameraIndex !== undefined) {
			cameraIndexToUse = self.currentSelectedCameraIndex
			self.log('debug', `Tracking request using currently selected camera index: ${cameraIndexToUse}`)
		}

		// Find the camera definition (from configuredCameras) which has the IP address
		if (cameraIndexToUse !== null && cameraIndexToUse !== undefined) {
			self.log('debug', `Looking for camera definition at index ${cameraIndexToUse}`)
			self.log('debug', `Available cameras: ${self.configuredCameras.map(c => `[id:${c.id}, index:${c.index}, ip:${c.ip}]`).join(', ')}`)

			const cameraDef = self.getCameraDefByIndex(cameraIndexToUse)
			if (cameraDef && cameraDef.ip) {
				selectedCamera = cameraDef
				// Track the currently selected camera for dynamic variable resolution
				self.currentSelectedCamera = cameraDef.id
				self.currentSelectedCameraIndex = cameraIndexToUse
				self.log('debug', `Found camera definition at index ${cameraIndexToUse}: id=${cameraDef.id}, ip=${cameraDef.ip}`)
			} else {
				self.log('warn', `Camera definition not found at index ${cameraIndexToUse}. cameraDef=${cameraDef ? JSON.stringify(cameraDef) : 'null'}. Available indices: ${self.configuredCameras.map(c => c.index).join(',')}`)
			}
		} else {
			self.log('warn', `No valid camera index determined. cameraIndexToUse: ${cameraIndexToUse}`)
		}

		// Fallback to first camera if not found
		if (!selectedCamera) {
			if (self.configuredCameras && self.configuredCameras.length > 0) {
				selectedCamera = self.configuredCameras[0]
				self.log('debug', `Using fallback camera (first configured): id=${selectedCamera.id}, index=${selectedCamera.index}, ip=${selectedCamera.ip}`)
			} else {
				self.log('error', `No cameras available in configuredCameras`)
			}
		}

		if (!selectedCamera || !selectedCamera.ip) {
			self.log('warn', `No valid camera found for tracking request. selectedCamera: ${selectedCamera ? `id=${selectedCamera.id}, ip=${selectedCamera.ip}` : 'null'}, configuredCameras length: ${self.configuredCameras?.length || 0}`)
			return { status: 'failed' }
		}

		const trackingAddonUrl =
			self.config.trackingAddonUrl || '/cgi-addon/Auto_Tracking_RA-AT001/app_ctrl/'

		const trackingBaseUrl = `http://${selectedCamera.ip}:${self.config.httpPort}${trackingAddonUrl}`
		const requestUrl = `${trackingBaseUrl}${cmd}`

		try {
			self.log('debug', `Sending tracking request to: ${requestUrl}`)
			const response = await axios.get(requestUrl, { timeout: 5000 })
			self.log('debug', `Tracking request succeeded: ${response.status}`)
			return {
				status: 'ok',
				response: response,
			}
		} catch (err) {
			self.log('warn', `Tracking request failed: ${requestUrl} - Error: ${err.message}`)
			return {
				status: 'failed',
				error: err.message,
			}
		}
	},

	async getCameraTrackingConfig(cameraIndex) {
		let self = this

		try {
			const cmd = 'get_config.cgi'
			self.log('debug', `getCameraTrackingConfig called with cameraIndex: ${cameraIndex}`)
			const result = await self.sendTrackingRequest(cmd, cameraIndex)

			if (result && result.response && result.response.data) {
				try {
					self.data.trackingConfig = result.response.data
					const trackingEnable = result.response.data.trackingEnable
					self.log('info', `Tracking config updated: trackingEnable="${trackingEnable}" (type: ${typeof trackingEnable}, raw: ${JSON.stringify(trackingEnable)})`)
					self.log('debug', `Full tracking config: ${JSON.stringify(result.response.data)}`)
					// Update feedbacks and variables when tracking config changes
					if (typeof self.checkFeedbacksValues === 'function') {
						self.checkFeedbacksValues()
					}
					if (typeof self.checkVariables === 'function') {
						self.checkVariables()
					}
				} catch (error) {
					self.log('warn', `Error parsing tracking config: ${error.message}`)
				}
			} else {
				self.log('debug', `Tracking config request returned no data: ${result?.status}`)
			}
		} catch (error) {
			// Silently handle - tracking is optional
			self.log('debug', `Tracking config fetch failed: ${error.message}`)
		}
	},

	async getCameraTrackingInformation(cameraIndex) {
		let self = this

		try {
			const cmd = 'track_info.cgi'
			self.log('debug', `getCameraTrackingInformation called with cameraIndex: ${cameraIndex}`)
			const result = await self.sendTrackingRequest(cmd, cameraIndex)

			if (result && result.response && result.response.data) {
				try {
					self.data.trackingInformation = result.response.data
					self.log('debug', `Tracking information updated for camera ${cameraIndex || 'selected'}`)
					// Update feedbacks and variables when tracking information changes
					if (typeof self.checkFeedbacksValues === 'function') {
						self.checkFeedbacksValues()
					}
					if (typeof self.checkVariables === 'function') {
						self.checkVariables()
					}
				} catch (error) {
					self.log('warn', `Error parsing tracking info: ${error.message}`)
				}
			} else {
				self.log('debug', `Tracking info request returned no data: ${result?.status}`)
			}
		} catch (error) {
			// Silently handle - tracking is optional
			self.log('debug', `Tracking info fetch failed: ${error.message}`)
		}
	},

	async sendTrackingCommand(base, cmd, cameraIndex) {
		let self = this

		try {
			const command = `${base}?${cmd}`
			self.log('info', `Sending tracking command: ${command} to camera index: ${cameraIndex || 'selected'}`)
			const result = await self.sendTrackingRequest(command, cameraIndex)

			if (result && result.response && result.response.data) {
				self.log('info', `Tracking command sent successfully to camera ${cameraIndex || 'selected'}: ${command}`)
				return true
			} else {
				self.log('warn', `Tracking command failed for camera ${cameraIndex || 'selected'}: ${command}`)
			}
			return false
		} catch (error) {
			self.log('warn', `Error sending tracking command: ${error.message}`)
			return false
		}
	},
}
