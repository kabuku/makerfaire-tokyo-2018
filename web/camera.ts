import { fromEvent, Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

export interface CameraManagerParameter {
  target: HTMLVideoElement;
  selector: HTMLSelectElement;
  option?: MediaTrackConstraints;
}

export async function setupCamera({
  target,
  selector,
  option = {}
}: CameraManagerParameter): Promise<void> {
  const cameras = await navigator.mediaDevices
    .enumerateDevices()
    .then(devices => devices.filter(({ kind }) => kind === 'videoinput'));
  if (cameras.length === 0) {
    return Promise.reject(new Error('This device does not have cameras'));
  }

  target.addEventListener('loadedmetadata', () => {
    const { videoWidth, videoHeight } = target;
    const aspectRatio = videoWidth / videoHeight;

    if (videoWidth < videoHeight) {
      target.height = target.width / aspectRatio;
    } else {
      target.width = aspectRatio * target.height;
    }
  });

  setupSelector(selector, cameras).subscribe(async exact => {
    if (target.srcObject) {
      (target.srcObject as MediaStream)
        .getTracks()
        .forEach(track => track.stop());
    }
    target.srcObject = await navigator.mediaDevices.getUserMedia({
      video: {
        ...option,
        deviceId: { exact }
      }
    });
  });
}

function setupSelector(
  selector: HTMLSelectElement,
  cameras: MediaDeviceInfo[]
): Observable<string> {
  const fragment = document.createDocumentFragment();
  for (const { deviceId, label } of cameras) {
    const option = document.createElement('option');
    option.value = deviceId;
    option.textContent = label;
    fragment.appendChild(option);
  }
  selector.appendChild(fragment);
  selector.selectedIndex = 0;
  return fromEvent(selector, 'change').pipe(
    map(() => selector.value),
    startWith(cameras[0].deviceId)
  );
}
