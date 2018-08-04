export const uploadImage = (data: string): Promise<Response> =>
  fetch('/upload', {
    body: JSON.stringify({ data }),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  });
