const fs = require('fs');
const path = require('path');

function processDirectory(dir) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      const original = content;

      // Fix cn
      content = content.replace(/from\s+['"](?:\.\.\/)+lib\/utils\/cn['"]/g, "from '@/lib/utils/cn'");
      
      // Fix store
      content = content.replace(/from\s+['"](?:\.\.\/)+lib\/store\/(.*?)['"]/g, "from '@/lib/store/$1'");
      
      // Fix constants
      content = content.replace(/from\s+['"](?:\.\.\/)+lib\/constants\/(.*?)['"]/g, "from '@/lib/constants/$1'");
      
      // Fix hooks
      content = content.replace(/from\s+['"](?:\.\.\/)+hooks\/(.*?)['"]/g, "from '@/hooks/$1'");

      // Fix ui components (e.g. from '../../ui/badge' to '@/components/ui/badge')
      content = content.replace(/from\s+['"](?:\.\.\/)+ui\/(.*?)['"]/g, "from '@/components/ui/$1'");

      if (content !== original) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`Updated alias imports in ${fullPath}`);
      }
    }
  }
}

processDirectory(path.join(__dirname, 'apps/ride-and-go/app'));
processDirectory(path.join(__dirname, 'apps/ride-and-go/components'));
processDirectory(path.join(__dirname, 'apps/ride-and-go/hooks'));
processDirectory(path.join(__dirname, 'apps/ride-and-go/lib'));
