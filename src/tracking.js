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
			self.pollTrackingTimer = setInterval(() => {
				try {
					self.getCameraTrackingConfig.bind(self)()
					self.getCameraTrackingInformation.bind(self)()
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
			return { status: 'failed' }
		}

		let selectedCamera = self.configuredCameras[0] // default to first camera

		// If cameraIndex is specified, resolve it and find the matching camera
		if (cameraIndex !== undefined && cameraIndex !== null) {
			const resolvedIndex = await self.parseVariablesInString(cameraIndex.toString())
			const parsedIndex = parseInt(resolvedIndex)
			if (!isNaN(parsedIndex)) {
				const foundCamera = self.getCameraByIndex(parsedIndex)
				if (foundCamera) {
					selectedCamera = foundCamera
				}
			}
		}

		if (!selectedCamera || !selectedCamera.ip) {
			return { status: 'failed' }
		}

		const trackingAddonUrl =
			self.config.trackingAddonUrl || '/cgi-addon/Auto_Tracking_RA-AT001/app_ctrl/'

		const trackingBaseUrl = `http://${selectedCamera.ip}:${self.config.httpPort}${trackingAddonUrl}`
		const requestUrl = `${trackingBaseUrl}${cmd}`

		try {
			const response = await axios.get(requestUrl, { timeout: 5000 })
			return {
				status: 'ok',
				response: response,
			}
		} catch (err) {
			// Silently fail - tracking is optional
			return {
				status: 'failed',
				error: err.message,
			}
		}
	},

	async getCameraTrackingConfig() {
		let self = this

		try {
			const cmd = 'get_config.cgi'
			const result = await self.sendTrackingRequest(cmd)

			if (result && result.response && result.response.data) {
				try {
					self.data.trackingConfig = result.response.data
					self.log('debug', 'Tracking config updated')
					// Don't call checkVariables/checkFeedbacks - tracking is optional
				} catch (error) {
					self.log('warn', `Error parsing tracking config: ${error.message}`)
				}
			}
		} catch (error) {
			// Silently handle - tracking is optional
			self.log('debug', `Tracking config fetch failed: ${error.message}`)
		}
	},

	async getCameraTrackingInformation() {
		let self = this

		try {
			const cmd = 'track_info.cgi'
			const result = await self.sendTrackingRequest(cmd)

			if (result && result.response && result.response.data) {
				try {
					self.data.trackingInformation = result.response.data
					self.log('debug', 'Tracking information updated')
					// Don't call checkVariables/checkFeedbacks - tracking is optional
				} catch (error) {
					self.log('warn', `Error parsing tracking info: ${error.message}`)
				}
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
			const result = await self.sendTrackingRequest(command, cameraIndex)

			if (result && result.response && result.response.data) {
				self.log('debug', 'Tracking command sent successfully')
				return true
			}
			return false
		} catch (error) {
			self.log('warn', `Error sending tracking command: ${error.message}`)
			return false
		}
	},
}
