const { InstanceStatus } = require('@companion-module/base')
const API = require('./api')

module.exports = {
	/**
	 * Inits the polling logic
	 */
	initPolling() {
		let self = this

		// Cleanup old interval
		if (self.pollTimer) {
			clearInterval(self.pollTimer)
		}

		clearInterval(self.pollTimerOnlineStatus)

		// Setup polling if enabled
		if (self.pollTimer === undefined && self.config.interval > 0) {
			self.pollTimer = setInterval(() => {
				self.getCameraInformation.bind(self)()
			}, self.config.interval)
		}

		// Setup online status polling (every 5 minutes)
		self.pollTimerOnlineStatus = setInterval(() => {
			self.getCameraInformation.bind(self)()
		}, 300000)
	},

	stopPolling() {
		let self = this

		if (self.pollTimer) {
			clearInterval(self.pollTimer)
			delete self.pollTimer
		}

		if (self.pollTimerOnlineStatus) {
			clearInterval(self.pollTimerOnlineStatus)
			delete self.pollTimerOnlineStatus
		}
	},

	async getCameraInformation() {
		if (!this.cameraRegistry || this.cameraRegistry.size === 0) {
			return // No cameras configured
		}
		for (const [cameraId, camera] of this.cameraRegistry.entries()) {
			await this.getCameraInformationForCamera(cameraId, camera)
		}
	},

	async getCameraInformationForCamera(cameraId, camera) {
		const connection = new API({
			...this.config,
			host: camera.host,
		})

		let result
		try {
			result = await connection.sendRequest('info.cgi')
		} catch (e) {
			this.log('warn', `Camera ${cameraId} not reachable`)
			return
		}

		if (!result || !result.response || !result.response.data) return

		const lines = String(result.response.data).split('\n')

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed) continue

			const str = trimmed.replace(':', '').split('=')
			this.storeData(cameraId, str)
		}
	},

	storeData(cameraId, str) {
		let self = this
		this.dataByCamera ??= {}

		// Log all data keys for debugging (first few lines only)
		if (str[0] && this.dataByCamera[cameraId] && this.dataByCamera[cameraId].info.length < 20) {
			self.log('debug', `Camera ${cameraId} data: ${str[0]}=${str[1]}`)
		}

		if (!this.dataByCamera[cameraId]) {
			this.dataByCamera[cameraId] = {
				info: [],
				modelDetected: '',
				cameraName: '',
				powerState: '',
				tallyState: '',
				tallyProgram: '',
				tallyPreview: '',
				digitalZoom: '',
				imageStabilization: '',
				firmwareVersion: '',
				protocolVersion: '',
				zoomValue: '',
				focusSpeed: 1,
				focusValue: 0,
				autoFocusMode: '',
				panTiltSpeedValue: 625,
				exposureShootingMode: 'auto',
				exposureShootingModeListString: '',
				exposureShootingModeList: null,
				exposureMode: 'auto',
				exposureModeListString: '',
				exposureModeList: null,
				shutterMode: 'manual',
				shutterValue: 2,
				shutterListString: '',
				shutterList: null,
				irisMode: 'manual',
				irisValue: 180,
				irisListString: '',
				irisList: null,
				gainMode: 'manual',
				gainValue: 10,
				ndfilterValue: '0',
				pedestalValue: '',
				whitebalanceMode: 'auto',
				whitebalanceModeListString: '',
				whitebalanceModeList: null,
				kelvinValue: '2000',
				kelvinListString: '',
				kelvinList: null,
				rGainValue: '0',
				bGainValue: '0',
				presetLastUsed: 1,
				presetRecallMode: 'normal',
				presetTimeValue: 2000,
				presetSpeedValue: 1,
				presetNames: {}, // Store preset names by preset number
				trackingConfig: {},
				trackingInformation: {},
				_modelProcessed: false, // Flag to prevent repeated model reload
			}
		}

		this.dataByCamera[cameraId].info.push(str)

		try {
			// Store Values from Events
			switch (str[0]) {
				// Model detection - only reload once
				case 'c.1.type':
					const detectedModel = str[1]
					this.dataByCamera[cameraId].modelDetected = detectedModel

					// Only process on first detection
					if (!this.dataByCamera[cameraId]._modelProcessed) {
						this.dataByCamera[cameraId]._modelProcessed = true

						// Only reload if in auto-detect mode
						if (self.config.model === 'Auto') {
							self.log('info', `Auto-detected model from camera: ${detectedModel}`)
							try {
								self.initActions()
								self.initFeedbacks()
								self.initVariables()
								self.initPresets()
								self.checkVariables()
								self.checkFeedbacks()
							} catch (e) {
								self.log('warn', `Error reloading on model detection: ${e.message}`)
							}
						}
					}
					break

				// System
				case 'c.1.name.utf8':
					this.dataByCamera[cameraId].cameraName = str[1]
					break
				case 'f.standby':
					this.dataByCamera[cameraId].powerState = str[1]
					break
				case 'f.tally':
					this.dataByCamera[cameraId].tallyState = str[1]
					break
				case 'f.tally.mode':
					if (str[1] === 'preview') {
						this.dataByCamera[cameraId].tallyPreview = this.dataByCamera[cameraId].tallyState
					} else {
						this.dataByCamera[cameraId].tallyProgram = this.dataByCamera[cameraId].tallyState
					}
					break

				// Zoom/Focus
				case 'c.1.zoom.mode':
					this.dataByCamera[cameraId].digitalZoom = str[1]
					break
				case 'c.1.zoom':
					this.dataByCamera[cameraId].zoomValue = str[1]
					break
				case 'c.1.is':
					this.dataByCamera[cameraId].imageStabilization = str[1]
					break
				case 'c.1.focus.speed':
					this.dataByCamera[cameraId].focusSpeed = str[1]
					break
				case 'c.1.focus.value':
					this.dataByCamera[cameraId].focusValue = str[1]
					break
				case 'c.1.focus':
					this.dataByCamera[cameraId].autoFocusMode = str[1]
					break

				// System info
				case 's.firmware':
					this.dataByCamera[cameraId].firmwareVersion = str[1]
					break
				case 's.protocol':
					this.dataByCamera[cameraId].protocolVersion = str[1]
					break

				// Exposure - Store values but don't reload
				case 'c.1.shooting':
					this.dataByCamera[cameraId].exposureShootingMode = str[1]
					break
				case 'c.1.shooting.list':
					if (this.dataByCamera[cameraId].exposureShootingModeListString !== str[1]) {
						this.dataByCamera[cameraId].exposureShootingModeListString = str[1]
						this.dataByCamera[cameraId].exposureShootingModeList = str[1].split(',')
						// Don't reload - only on initial config
					}
					break
				case 'c.1.exp':
					this.dataByCamera[cameraId].exposureMode = str[1]
					break
				case 'c.1.exp.list':
					if (this.dataByCamera[cameraId].exposureModeListString !== str[1]) {
						this.dataByCamera[cameraId].exposureModeListString = str[1]
						this.dataByCamera[cameraId].exposureModeList = str[1].split(',')
					}
					break

				// Shutter
				case 'c.1.me.shutter.mode':
					this.dataByCamera[cameraId].shutterMode = str[1]
					break
				case 'c.1.me.shutter':
					this.dataByCamera[cameraId].shutterValue = str[1]
					break
				case 'c.1.me.shutter.list':
					if (this.dataByCamera[cameraId].shutterListString !== str[1]) {
						this.dataByCamera[cameraId].shutterListString = str[1]
						this.dataByCamera[cameraId].shutterList = str[1].split(',')
					}
					break

				// Iris
				case 'c.1.me.diaphragm.mode':
					this.dataByCamera[cameraId].irisMode = str[1]
					break
				case 'c.1.me.diaphragm':
					this.dataByCamera[cameraId].irisValue = str[1]
					break
				case 'c.1.me.diaphragm.list':
					if (this.dataByCamera[cameraId].irisListString !== str[1]) {
						this.dataByCamera[cameraId].irisListString = str[1]
						this.dataByCamera[cameraId].irisList = str[1].split(',')
					}
					break

				// Gain
				case 'c.1.me.gain.mode':
					this.dataByCamera[cameraId].gainMode = str[1]
					break
				case 'c.1.me.gain':
					this.dataByCamera[cameraId].gainValue = str[1]
					break

				// Filters
				case 'c.1.nd.filter':
					this.dataByCamera[cameraId].ndfilterValue = str[1]
					break
				case 'c.1.blacklevel':
					this.dataByCamera[cameraId].pedestalValue = str[1]
					break

				// White Balance
				case 'c.1.wb':
					this.dataByCamera[cameraId].whitebalanceMode = str[1]
					break
				case 'c.1.wb.list':
					if (this.dataByCamera[cameraId].whitebalanceModeListString !== str[1]) {
						this.dataByCamera[cameraId].whitebalanceModeListString = str[1]
						this.dataByCamera[cameraId].whitebalanceModeList = str[1].split(',')
					}
					break
				case 'c.1.wb.kelvin':
					this.dataByCamera[cameraId].kelvinValue = str[1]
					break
				case 'c.1.wb.kelvin.list':
					if (this.dataByCamera[cameraId].kelvinListString !== str[1]) {
						this.dataByCamera[cameraId].kelvinListString = str[1]
						this.dataByCamera[cameraId].kelvinList = str[1].split(',')
					}
					break
				case 'c.1.wb.shift.rgain':
					this.dataByCamera[cameraId].rGainValue = str[1]
					break
				case 'c.1.wb.shift.bgain':
					this.dataByCamera[cameraId].bGainValue = str[1]
					break

				// Presets
				case 'p':
					this.dataByCamera[cameraId].presetLastUsed = parseInt(str[1])
					self.checkVariables()
					self.checkFeedbacks()
					break

				// Preset names (p.1.name.utf8, p.2.name.utf8, etc.)
				default:
					// Handle preset names with pattern p.N.name.utf8
					if (str[0] && str[0].match(/^p\.\d+\.name\.utf8$/)) {
						const presetMatch = str[0].match(/^p\.(\d+)\.name\.utf8$/)
						if (presetMatch) {
							const presetNumber = parseInt(presetMatch[1])
							if (!isNaN(presetNumber)) {
								// Ensure presetNames object exists
								if (!this.dataByCamera[cameraId].presetNames) {
									this.dataByCamera[cameraId].presetNames = {}
								}
								this.dataByCamera[cameraId].presetNames[presetNumber] = str[1]
								self.log('info', `✓ Stored preset ${presetNumber} name "${str[1]}" from camera ${cameraId}`)
								// Update variables when preset names change
								self.checkVariables()
							}
						}
					}
					break
			}
		} catch (error) {
			self.log('error', 'Error parsing response from PTZ: ' + String(error))
		}
	},

	getCameraInformation_Delayed() {
		let self = this
		setTimeout(self.getCameraInformation.bind(self), 500)
	},
}
