const fs = require('fs');
const path = require('path');

// Fix case sensitivity on macOS
const uiDir = path.join(__dirname, 'apps/ride-and-go/components/ui');
const files = fs.readdirSync(uiDir);

for (const file of files) {
  if (file.endsWith('.tsx')) {
    const fullPath = path.join(uiDir, file);
    const tmpPath = path.join(uiDir, file + '_tmp');
    fs.renameSync(fullPath, tmpPath);
    fs.renameSync(tmpPath, path.join(uiDir, file.toLowerCase()));
  }
}

function processDirectory(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Fix wrong relative paths from inside components
      const original = content;
      content = content.replace(/from\s+['"]\.\.\/\.\.\/ui\/(.*?)['"]/g, "from '../ui/$1'");
      
      // Fix aliased components that were missed
      content = content.replace(/from\s+['"]@\/components\/ui\/([A-Z])(.*?)['"]/g, (match, p1, p2) => {
        return `from '@/components/ui/${p1.toLowerCase()}${p2}'`;
      });

      if (content !== original) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated paths in ${fullPath}`);
      }
    }
  }
}

processDirectory(path.join(__dirname, 'apps/ride-and-go/app'));
processDirectory(path.join(__dirname, 'apps/ride-and-go/components'));
