const fs = require('fs');

let content = fs.readFileSync('src/actions.js', 'utf8');

// Pattern: Find actions with options: [ ... { ... } ] and add camera selection as first option
// Match the pattern of options arrays with existing options

const cameraOption = `{
						type: 'textinput',
						label: 'Camera Index',
						id: 'camera_index',
						default: '1',
						tooltip: 'Enter camera index number (1-4) or variable like \$(custom:selectedCameraIndex)',
					},
					`;

// List of action names that have additional options
const actionsWithSteps = [
	'irisU', 'irisD', 'gainU', 'gainD', 'zoomValue', 'focusToggle',
	'pedestalU', 'pedestalD', 'ndFilterU', 'ndFilterD'
];

let updated = 0;

for (const actionName of actionsWithSteps) {
	// Pattern: actions.NAME = { ... options: [ { type...
	const pattern = new RegExp(
		`(actions\\.${actionName}\\s*=\\s*{[^}]*?options:\\s*\\[)(?!\\s*self\\.getCameraSelectionOptions)`,
		's'
	);
	
	if (pattern.test(content)) {
		const updatedContent = content.replace(
			pattern,
			`$1\n\t\t\t\t\t${cameraOption}`
		);
		
		if (updatedContent !== content) {
			content = updatedContent;
			updated++;
			
			// Also update sendPTZ calls to include camera_index
			const sendPtzPattern = new RegExp(
				`(actions\\.${actionName}[^]*?self\\.sendPTZ\\([^,]+,[^)]+)\\)`,
				's'
			);
			content = content.replace(
				sendPtzPattern,
				`$1, action.options.camera_index)`
			);
		}
	}
}

fs.writeFileSync('src/actions.js', content, 'utf8');
console.log(`Updated ${updated} actions with complex options`);
