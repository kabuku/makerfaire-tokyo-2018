import { fromEvent, merge, Observable, of } from 'rxjs';
import { map, filter, shareReplay } from 'rxjs/operators';

export function createTopic$(window: Window): Observable<string> {
  return merge(of(null), fromEvent(window, 'hashchange')).pipe(
    map(() => window.location.hash.slice(1)),
    filter(Boolean),
    shareReplay()
  );
}
