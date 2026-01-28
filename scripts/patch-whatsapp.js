const fs = require('fs');
const path = require('path');

const utilsPath = path.join(__dirname, '../node_modules/whatsapp-web.js/src/util/Injected/Utils.js');

if (!fs.existsSync(utilsPath)) {
    console.log('whatsapp-web.js not installed yet, skipping patch');
    process.exit(0);
}

let content = fs.readFileSync(utilsPath, 'utf8');

// Check if already patched with new version
if (content.includes('Skipped: GroupMetadata.update')) {
    console.log('whatsapp-web.js already patched (v2)');
    process.exit(0);
}

const newCode = `// Skipped: GroupMetadata.update breaks event system
            // await window.Store.GroupMetadata.update(chatWid);`;

// Try to patch original code
const originalCode = 'await window.Store.GroupMetadata.update(chatWid);';
if (content.includes(originalCode)) {
    content = content.replace(originalCode, newCode);
    fs.writeFileSync(utilsPath, content);
    console.log('Patched whatsapp-web.js: Skipped GroupMetadata.update');
    process.exit(0);
}

// Try to patch old v1 patch (GroupQueryAndUpdate)
const oldPatchCode = `try {
                await window.Store.GroupQueryAndUpdate(chatWid);
            } catch (e) {
                // Ignore GroupMetadata update errors
            }`;
if (content.includes('GroupQueryAndUpdate(chatWid)')) {
    content = content.replace(oldPatchCode, newCode);
    fs.writeFileSync(utilsPath, content);
    console.log('Patched whatsapp-web.js: Replaced GroupQueryAndUpdate with skip');
    process.exit(0);
}

console.log('Could not find code to patch - whatsapp-web.js may have changed');
