const fs = require('fs');
const path = require('path');

const pairs = [
  { src: 'js', dest: path.join('public', 'js'), isDir: true },
  { src: 'style.css', dest: path.join('public', 'style.css') },
  { src: 'index.html', dest: path.join('public', 'index.html') },
  { src: 'settings.html', dest: path.join('public', 'settings.html') },
  { src: 'report.html', dest: path.join('public', 'report.html') }
];

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
  console.log(`Copied ${src} -> ${dest}`);
}

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`Copied ${srcPath} -> ${destPath}`);
    }
  }
}

pairs.forEach(({ src, dest, isDir }) => {
  const srcPath = path.resolve(src);
  const destPath = path.resolve(dest);
  if (!fs.existsSync(srcPath)) {
    console.warn(`Skip missing ${srcPath}`);
    return;
  }
  if (isDir) {
    copyDir(srcPath, destPath);
  } else {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    copyFile(srcPath, destPath);
  }
});
