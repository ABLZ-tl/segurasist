import { mockHttpContext } from '../../../test/mocks/execution-context.mock';
import { ThrottleGuard } from './throttle.guard';

describe('ThrottleGuard (stub Sprint 0)', () => {
  it('siempre permite el paso (stub a implementar)', () => {
    const guard = new ThrottleGuard();
    expect(guard.canActivate(mockHttpContext({}))).toBe(true);
  });
});
