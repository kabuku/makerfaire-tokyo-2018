const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const pathPrefix = 'https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/';
const model = 'model.json';
const distDir = path.resolve(__dirname, '../dist');

fetch(pathPrefix + model)
  .then(response => response.json())
  .then(json => {
    const allPaths = [];
    json.weightsManifest.forEach(manifest => {
      allPaths.push(...manifest.paths);
      // Parcel requires asset files to have extension
      // https://github.com/parcel-bundler/parcel/issues/1098
      manifest.paths = manifest.paths.map(p => p + '.buf');
    });
    return Promise.all([
      new Promise((resolve, reject) =>
        fs.writeFile(path.resolve(distDir, model), JSON.stringify(json), err => err ? reject(err) : resolve())
      ),
      ...allPaths.map(lastPath => loadWeight(pathPrefix, lastPath))
    ]);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

async function loadWeight(pathPrefix, lastPath) {
  const arrayBuffer = await fetch(pathPrefix + lastPath).then(response => response.arrayBuffer());
  const buffer = new Buffer(arrayBuffer.byteLength);
  const temp = new Uint8Array(arrayBuffer);
  for(let i = 0; i < buffer.length; i++) {
    buffer[i] = temp[i];
  }
  return new Promise((resolve, reject) =>
    fs.writeFile(path.resolve(distDir, lastPath + '.buf'), buffer, err => err ? reject(err) : resolve())
  );
}
