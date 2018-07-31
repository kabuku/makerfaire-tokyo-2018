const dropboxFolderName = process.env.DROPBOX_FOLDER_NAME;
const accessToken = process.env.DROPBOX_ACCESS_TOKEN;

export const uploadImage = (blob: Blob): Promise<Response> => {
  const url = `https://content.dropboxapi.com/2/files/upload`;
  return fetch(url, {
    body: blob,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path: `/${dropboxFolderName}/image.png`,
        autorename: true
      })
    }
  });
};

export const getTemporaryLink = (name: string): Promise<Response> => {
  const url = `https://api.dropboxapi.com/2/files/get_temporary_link`;
  return fetch(url, {
    body: JSON.stringify({ path: `/${dropboxFolderName}/${name}` }),
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });
};
