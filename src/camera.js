const API = require('./api')

class CanonCamera {
	constructor(config) {
		this.config = config
		this.host = config.host
		this.api = new API(config)
		this.isOnline = false
	}

	async destroy() {
		// Cleanup if needed
	}

	getAPI() {
		return this.api
	}

	setOnline(status) {
		this.isOnline = status
	}

	isConnected() {
		return this.isOnline
	}
}

module.exports = CanonCamera
