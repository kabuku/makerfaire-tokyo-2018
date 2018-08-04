import glob from 'glob';
import { uploadPlayImage } from '../web/uploadPlayImage';

glob('./play-images/!(.gitignore)', async (err, files) => {
  if (err) {
    return console.error(err);
  }
  if (files.length === 0) {
    return console.log('no file');
  }
  for (const file of files) {
    await uploadPlayImage(file);
  }
});
