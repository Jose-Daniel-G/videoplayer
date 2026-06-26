npm init -y
npm install electron --save-dev
npm install @electron-forge/cli --save-dev
npx electron-forge import

npm i
npm start

## Install electron-builder
npm install electron-builder --save-dev

## Generate .exe
npm run dist

### Deshacer el commit problemático
git reset --soft HEAD~1


### Retroceder el historial de Git por completo
git reset --mixed origin/main

### Limpiar la memoria caché interna de Git
git rm -r --cached node_modules/ --ignore-unmatch
git rm -r --cached videos/ --ignore-unmatch


### Borrar la carpeta oculta de Git dañada
Remove-Item -Recurse -Force .git

## Install
Ve a tu carpeta dist/. Ahora verás un archivo comprimido llamado RemanenteMultimedia-1.0.0-win.exe.

Para que funcione desactiva Smart App Control.