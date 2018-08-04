import { BehaviorSubject, fromEvent, interval, Observable } from 'rxjs';
import {
  switchMap,
  filter,
  map,
  takeUntil,
  startWith,
  scan,
  flatMap
} from 'rxjs/operators';
import { Rect } from './camera';

export const getCropArea = (
  faceDetectionEnabled$: BehaviorSubject<boolean>,
  canvas: HTMLCanvasElement
): Observable<Rect | null> => {
  const mousedown$ = fromEvent<MouseEvent>(canvas, 'mousedown');
  const mousemove$ = fromEvent<MouseEvent>(canvas, 'mousemove');
  const mouseup$ = fromEvent<MouseEvent>(canvas, 'mouseup');

  const getMousePoint = (ev: MouseEvent) => ({ x: ev.offsetX, y: ev.offsetY });

  return mousedown$.pipe(
    filter(() => !faceDetectionEnabled$.getValue()),
    switchMap(md =>
      mousemove$.pipe(
        filter(mm => mm.target === canvas),
        map(mm => [md, mm]),
        takeUntil(mouseup$)
      )
    ),
    map(([mousedown, mousemove]) => {
      const down = getMousePoint(mousedown);
      const move = getMousePoint(mousemove);
      const x = down.x;
      const y = down.y;
      const width = move.x - down.x;
      const height = move.y - down.y;
      const size = Math.max(width, height);
      return { x, y, width: size, height: size };
    }),
    startWith(null)
  );
};

export const getCropAreaWithFaceDetector = (
  faceDetectionEnabled$: BehaviorSubject<boolean>,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  xDiff: number
): Observable<Rect> => {
  let faceDetector: FaceDetector;
  if (typeof (FaceDetector as any) === 'function') {
    faceDetector = new FaceDetector();
  }
  const clickCanvas$ = fromEvent(canvas, 'click');
  return clickCanvas$.pipe(
    scan(detecting => faceDetectionEnabled$.getValue() && !detecting, false),
    filter(Boolean),
    switchMap(() => interval(500).pipe(takeUntil(clickCanvas$))),
    filter(() => faceDetectionEnabled$.getValue()),
    flatMap(() => faceDetector.detect(video)),
    filter(faces => faces.length > 0),
    map(faces =>
      faces.reduce(
        (max, current) =>
          max.boundingBox.width > current.boundingBox.width ? max : current
      )
    ),
    map(({ boundingBox }) => {
      let { x, y, width, height } = boundingBox;
      x = video.width - width - x - xDiff;
      return { x, y, width, height };
    })
  );
};
