// Canon PTZ Multi-Camera Module for Bitfocus Companion

const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const { parseCameras } = require('./parseCameras')
const CanonCamera = require('./camera')
const config = require('./config')
const actions = require('./actions')
const feedbacks = require('./feedbacks')
const variables = require('./variables')
const presets = require('./presets')
const polling = require('./polling')
const utils = require('./utils')
const tracking = require('./tracking')

class CanonPTZMultiCamInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		// Initialize camera registry - maps camera_X to camera object
		this.cameraRegistry = new Map()
		this.configuredCameras = [] // Array of {id, ip, index}

		// Polling timers
		this.pollTimer = undefined
		this.pollTimerOnlineStatus = undefined
		this.pollTrackingTimer = undefined

		// Global state object - initialize with full default camera data structure
		// This is used by actions/feedbacks/variables for compatibility
		this.data = {
			debug: false,
			model: 'Auto',
			modelDetected: '',
			series: 'Auto',
			//System
			cameraName: '',
			powerState: '',
			tallyState: '',
			tallyProgram: '',
			tallyPreview: '',
			digitalZoom: '',
			imageStabilization: '',
			firmwareVersion: '',
			protocolVersion: '',
			platformStatus: '',

			//Zoom/Focus
			zoomSpeed: 8,
			zoomValue: '',
			focusSpeed: 1,
			focusValue: 0,
			autoFocusMode: '',

			//Pan/Tilt
			panTiltSpeedValue: 625,

			//Exposure
			exposureShootingMode: 'auto',
			exposureShootingModeListString: '',
			exposureShootingModeList: null,
			exposureMode: 'auto',
			exposureModeListString: '',
			exposureModeList: null,
			aeGainLimitMax: 330,
			aeGainLimitMaxMin: -60,
			aeGainLimitMaxMax: 330,
			aeBrightness: 0,
			aeBrightnessListString: '',
			aeBrightnessList: null,
			aePhotometry: 'center',
			aePhotometryListString: '',
			aePhotometryList: null,
			aeFlickerReduct: 'off',
			aeFlickerReductListString: '',
			aeFlickerReductList: null,
			aeResp: 1,
			aeRespMin: 0,
			aeRespMax: 2,
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
			aeShiftValue: 0,

			//White Balance
			whitebalanceMode: 'auto',
			whitebalanceModeListString: '',
			whitebalanceModeList: null,
			kelvinValue: '2000',
			kelvinListString: '',
			kelvinList: null,
			rGainValue: '0',
			bGainValue: '0',

			//Recall Preset
			presetLastUsed: 1,
			presetRecallMode: 'normal',
			presetTimeValue: 2000,
			presetSpeedValue: 1,

			trackingConfig: {
				trackingEnable: '0',  // Default to off
			},
			trackingInformation: {},
		}

		// Add preset names (1-100) to this.data
		for (let i = 1; i <= 100; i++) {
			this.data[`presetname${i}`] = i
		}

		// Per-camera state storage
		this.dataByCamera = {}

		// Track currently selected camera for dynamic variable resolution
		this.currentSelectedCamera = null
		this.currentSelectedCameraIndex = null
		this.lastCheckedSelectedCameraIndex = null  // Track for detecting changes

		// Active actions tracking
		this.activeActions = new Map()
		this.customTraceLoop = false

		// Speed indices for various controls
		this.ptSpeed = 625
		this.ptSpeedIndex = 4
		this.zSpeed = 8
		this.zSpeedIndex = 7
		this.fSpeed = 1
		this.fSpeedIndex = 1
		this.exposureModeIndex = 0
		this.shutterValue = 0
		this.shutterIndex = 0
		this.irisValue = 'auto'
		this.irisIndex = 0
		this.gainValue = 'auto'
		this.gainIndex = 0
		this.ndfilterValue = '0'
		this.ndfilterIndex = 0
		this.pedestalValue = 0
		this.pedestalIndex = 51
		this.aeShiftValue = 0
		this.aeShiftIndex = 8
		this.whitebalanceModeIndex = 0
		this.kelvinIndex = 0
		this.kelvinValue = 2820
		this.rGainIndex = 50
		this.rGainValue = 0
		this.bGainIndex = 50
		this.bGainValue = 0
		this.presetRecallModeIndex = 0
		this.presetLastUsedIndex = 0
		this.presetDriveTimeIndex = 0
		this.presetDriveSpeedIndex = 0

		// PTZ command prefixes
		this.ptzCommand = 'control.cgi?'
		this.powerCommand = 'standby.cgi?'
		this.savePresetCommand = 'preset/set?'
		this.traceCommand = 'trace/'
		this.maintainCommand = 'maintain?'

		// Mix in methods from feature modules
		Object.assign(this, {
			...config,
			...actions,
			...feedbacks,
			...variables,
			...presets,
			...polling,
			...utils,
			...tracking,
		})
	}

	/**
	 * When instance is destroyed, clean up resources
	 */
	async destroy() {
		this.log('info', 'Module instance destroying...')

		// Stop polling
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}

		if (this.pollTimerOnlineStatus) {
			clearInterval(this.pollTimerOnlineStatus)
			this.pollTimerOnlineStatus = null
		}

		if (this.pollTrackingTimer) {
			clearInterval(this.pollTrackingTimer)
			this.pollTrackingTimer = null
		}

		// Destroy camera instances
		for (const cam of this.cameraRegistry.values()) {
			if (cam.destroy) {
				try {
					cam.destroy()
				} catch (e) {
					this.log('warn', `Error destroying camera: ${e.message}`)
				}
			}
		}

		this.cameraRegistry.clear()
		this.log('info', 'Module instance destroyed')
	}

	/**
	 * Companion calls init when the module instance is created
	 */
	async init(config) {
		this.log('debug', 'Module init() called')
		await this.configUpdated(config)
	}

	/**
	 * Companion calls configUpdated when:
	 * 1. The module instance is first created (during init)
	 * 2. The user saves changes in the config dialog
	 */
	async configUpdated(config) {
		this.log('debug', 'configUpdated() called')

		try {
			this.updateStatus(InstanceStatus.Connecting, 'Loading configuration...')

			// Stop existing polling before we reload config
			if (this.pollTimer) {
				this.stopPolling()
			}

			// Store the new config
			this.config = config
			this.log('debug', `Config received: ${JSON.stringify({
				model: config.model,
				httpPort: config.httpPort,
				interval: config.interval,
				enableTracking: config.enableTracking,
			})}`)

			// === STEP 1: Parse configured cameras from config fields ===
			this.configuredCameras = parseCameras(this.config)
			this.log('info', `Parsed ${this.configuredCameras.length} configured cameras`)

			if (this.configuredCameras.length > 0) {
				this.configuredCameras.forEach((cam) => {
					this.log('info', `  Camera Index ${cam.index}: ${cam.ip}`)
				})
			}

			// === STEP 2: Rebuild camera registry ===
			for (const cam of this.cameraRegistry.values()) {
				if (cam.destroy) {
					try {
						cam.destroy()
					} catch (e) {
						this.log('warn', `Error destroying camera: ${e.message}`)
					}
				}
			}
			this.cameraRegistry.clear()
			this.dataByCamera = {}

			// Create camera instances for each configured camera
			for (const camDef of this.configuredCameras) {
				try {
					const cam = new CanonCamera({
						id: camDef.id,
						host: camDef.ip,
						port: this.config.httpPort || 80,
						username: this.config.username || '',
						password: this.config.password || '',
						debug: this.config.debug || false,
					})

					this.cameraRegistry.set(camDef.id, cam)
					this.log('debug', `Created camera instance for ${camDef.id}`)

					// Initialize per-camera state
					this.dataByCamera[camDef.id] = this.createDefaultCameraData()
				} catch (e) {
					this.log('error', `Failed to create camera ${camDef.id}: ${e.message}`)
				}
			}

			// === STEP 3: Set safe config defaults ===
			this.config.httpPort = parseInt(this.config.httpPort) || 80
			this.config.model = this.config.model || 'Auto'
			this.config.debug = this.config.debug === true
			this.config.interval = parseInt(this.config.interval) || 5000
			this.config.continuePolling = this.config.continuePolling === true
			this.config.enableTracking = this.config.enableTracking === true
			this.config.trackingAddonUrl =
				this.config.trackingAddonUrl || '/cgi-addon/Auto_Tracking_RA-AT001/app_ctrl/'
			this.config.trackingInterval = parseInt(this.config.trackingInterval) || 250
			this.config.username = this.config.username || ''
			this.config.password = this.config.password || ''
			this.config.verbose = this.config.verbose !== false

			// === STEP 4: Initialize actions, feedbacks, variables, presets ===
			try {
				this.log('debug', 'Initializing actions...')
				this.initActions()
				this.log('debug', 'Initializing feedbacks...')
				this.initFeedbacks()
				this.log('debug', 'Initializing variables...')
				this.initVariables()
				this.log('debug', 'Initializing presets...')
				this.initPresets()
			} catch (e) {
				this.log('warn', `Non-fatal error initializing actions/feedbacks/variables/presets: ${e.message}`)
				this.log('debug', e.stack)
				// Don't throw - allow module to continue and reach Ok status
				// This allows initial configuration even with setup issues
			}

			// === STEP 5: Check variables and feedbacks ===
			try {
				if (typeof this.checkVariables === 'function') {
					this.checkVariables()
				}
				if (typeof this.checkFeedbacks === 'function') {
					this.checkFeedbacks()
				}
			} catch (e) {
				this.log('warn', `Non-fatal error checking variables/feedbacks: ${e.message}`)
				// Don't rethrow - continue with initialization
			}

			// === STEP 6: Set status - GUARANTEED ===
			let statusMsg = this.configuredCameras.length === 0
				? 'Ready - Configure cameras in settings'
				: `${this.configuredCameras.length} camera(s) configured`

			this.updateStatus(InstanceStatus.Ok, statusMsg)
			this.log('info', `Module status set to Ok: ${statusMsg}`)

			// === STEP 7: Start polling ===
			try {
				this.log('debug', 'Starting polling...')
				if (typeof this.initPolling === 'function') {
					this.initPolling()
				}

				if (this.config.enableTracking && typeof this.initTrackingPolling === 'function') {
					this.log('debug', 'Starting tracking polling...')
					this.initTrackingPolling()
				}
			} catch (e) {
				this.log('warn', `Non-fatal error starting polling: ${e.message}`)
				// Don't rethrow - module can function without polling
			}

			this.log('info', 'configUpdated() completed successfully')
		} catch (error) {
			this.log('error', `Fatal error in configUpdated: ${error.message}`)
			this.log('error', error.stack)
			this.updateStatus(InstanceStatus.Error, `Initialization failed: ${error.message}`)
		}
	}

	/**
	 * Create default per-camera data structure
	 */
	createDefaultCameraData() {
		return {
			info: [],
			isOnline: false, // Track if camera is reachable
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
			platformStatus: '',

			// Zoom/Focus
			zoomSpeed: 8,
			zoomValue: '',
			focusSpeed: 1,
			focusValue: 0,
			autoFocusMode: '',

			// Pan/Tilt
			panTiltSpeedValue: 625,

			// Exposure
			exposureShootingMode: 'auto',
			exposureShootingModeListString: '',
			exposureShootingModeList: null,
			exposureMode: 'auto',
			exposureModeListString: '',
			exposureModeList: null,
			aeGainLimitMax: 330,
			aeGainLimitMaxMin: -60,
			aeGainLimitMaxMax: 330,
			aeBrightness: 0,
			aeBrightnessListString: '',
			aeBrightnessList: null,
			aePhotometry: 'center',
			aePhotometryListString: '',
			aePhotometryList: null,
			aeFlickerReduct: 'off',
			aeFlickerReductListString: '',
			aeFlickerReductList: null,
			aeResp: 1,
			aeRespMin: 0,
			aeRespMax: 2,
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
			aeShiftValue: 0,

			// White Balance
			whitebalanceMode: 'auto',
			whitebalanceModeListString: '',
			whitebalanceModeList: null,
			kelvinValue: '2000',
			kelvinListString: '',
			kelvinList: null,
			rGainValue: '0',
			bGainValue: '0',

			// Recall Preset
			presetLastUsed: 1,
			presetRecallMode: 'normal',
			presetTimeValue: 2000,
			presetSpeedValue: 1,

			trackingConfig: {
				trackingEnable: '0',  // Default to off
			},
			trackingInformation: {},
		}
	}

	/**
	 * Get a camera from the registry by index
	 */
	getCameraByIndex(index) {
		const camDef = this.configuredCameras.find((c) => c.index === index)
		if (!camDef) {
			this.log('warn', `Camera with index ${index} not found`)
			return null
		}
		return this.cameraRegistry.get(camDef.id) || null
	}

	/**
	 * Get camera definition by index
	 */
	getCameraDefByIndex(index) {
		return this.configuredCameras.find((c) => c.index === index) || null
	}

	/**
	 * Get all configured camera indexes
	 */
	getAllCameraIndexes() {
		return this.configuredCameras.map((c) => c.index)
	}

	/**
	 * Get all cameras as choice list for dropdowns
	 */
	getCameraChoices() {
		return this.configuredCameras.map((cam) => ({
			id: String(cam.index),
			label: `Camera ${cam.index} (${cam.ip})`,
		}))
	}
}

runEntrypoint(CanonPTZMultiCamInstance, UpgradeScripts)
