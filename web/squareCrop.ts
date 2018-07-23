import { fromEvent, Observable } from 'rxjs';
import { switchMap, filter, map, takeUntil, startWith } from 'rxjs/operators';
import { Rect } from './camera';

export const getCropArea = (
  canvas: HTMLCanvasElement
): Observable<Rect | null> => {
  const mousedown$ = fromEvent<MouseEvent>(canvas, 'mousedown');
  const mousemove$ = fromEvent<MouseEvent>(canvas, 'mousemove');
  const mouseup$ = fromEvent<MouseEvent>(canvas, 'mouseup');

  const getMousePoint = (ev: MouseEvent) => ({ x: ev.offsetX, y: ev.offsetY });

  return mousedown$.pipe(
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
