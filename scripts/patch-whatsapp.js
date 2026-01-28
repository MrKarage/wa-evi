const fs = require('fs');
const path = require('path');

const utilsPath = path.join(__dirname, '../node_modules/whatsapp-web.js/src/util/Injected/Utils.js');

if (!fs.existsSync(utilsPath)) {
    console.log('whatsapp-web.js not installed yet, skipping patch');
    process.exit(0);
}

let content = fs.readFileSync(utilsPath, 'utf8');

// Check if already patched
if (content.includes('GroupQueryAndUpdate(chatWid)')) {
    console.log('whatsapp-web.js already patched');
    process.exit(0);
}

// Fix: Replace GroupMetadata.update with GroupQueryAndUpdate
const oldCode = 'await window.Store.GroupMetadata.update(chatWid);';
const newCode = `try {
                await window.Store.GroupQueryAndUpdate(chatWid);
            } catch (e) {
                // Ignore GroupMetadata update errors
            }`;

if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync(utilsPath, content);
    console.log('Patched whatsapp-web.js: Fixed GroupMetadata.update error');
} else {
    console.log('Could not find code to patch - whatsapp-web.js may have changed');
}
