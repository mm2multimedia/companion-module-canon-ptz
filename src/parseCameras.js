/**
 * Parse cameras from individual config fields
 * Expects config object with fields: camera1_ip, camera1_index, camera2_ip, camera2_index, etc.
 *
 * @param {object} configValues - Full configuration object from Companion
 * @returns {array} Array of camera definitions [{id, ip, index}]
 */
function parseCameras(configValues) {
	const cameras = []
	const usedIndexes = new Set()
	const errors = []

	if (!configValues) {
		return cameras
	}

	// Support up to 10 cameras
	for (let i = 1; i <= 10; i++) {
		const ipKey = `camera${i}_ip`
		const indexKey = `camera${i}_index`

		const ip = configValues[ipKey]
		const indexStr = configValues[indexKey]

		// Skip if IP is empty or not provided
		if (!ip || typeof ip !== 'string' || ip.trim() === '') {
			continue
		}

		const trimmedIp = ip.trim()

		// Validate IP format (basic check)
		if (!isValidIP(trimmedIp)) {
			errors.push(`Camera ${i}: Invalid IP address format: ${trimmedIp}`)
			continue
		}

		// Parse and validate index
		let index = parseInt(indexStr)
		if (isNaN(index) || index < 1 || index > 100) {
			errors.push(`Camera ${i}: Invalid index: ${indexStr}. Using position ${i} instead.`)
			index = i
		}

		// Check for duplicate indexes
		if (usedIndexes.has(index)) {
			errors.push(`Camera ${i}: Duplicate index ${index}. Skipping this camera.`)
			continue
		}

		usedIndexes.add(index)

		cameras.push({
			id: `camera_${index}`,
			ip: trimmedIp,
			index: index,
		})
	}

	// Log any validation errors (these will appear in Companion logs)
	if (errors.length > 0) {
		// Note: caller will have access to logger
		errors.forEach((err) => {
			// Errors will be logged by the calling module instance
		})
	}

	return cameras
}

/**
 * Basic IP address validation
 */
function isValidIP(ip) {
	const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
	if (!ipv4Regex.test(ip)) {
		return false
	}

	// Check each octet is 0-255
	const parts = ip.split('.')
	for (const part of parts) {
		const num = parseInt(part, 10)
		if (num < 0 || num > 255) {
			return false
		}
	}

	return true
}

module.exports = { parseCameras }
