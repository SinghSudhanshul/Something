const fs = require('fs');
const path = require('path');

const uiComponents = [
  'Avatar', 'Badge', 'Button', 'Card', 'Confetti', 'Input', 'Skeleton', 'Tabs', 'Tooltip'
];

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let changed = false;
      for (const comp of uiComponents) {
        // Regex to replace paths ending with the capitalized component name
        const regex = new RegExp(`(['"])(.*?\\/ui\\/)${comp}(['"])`, 'g');
        if (regex.test(content)) {
          content = content.replace(regex, `$1$2${comp.toLowerCase()}$3`);
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated imports in ${fullPath}`);
      }
    }
  }
}

processDirectory(path.join(__dirname, 'apps/ride-and-go/app'));
processDirectory(path.join(__dirname, 'apps/ride-and-go/components'));
