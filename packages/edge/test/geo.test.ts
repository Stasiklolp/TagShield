import { describe, it, expect } from 'vitest';
import { resolveRegime } from '../src/geo';

describe('resolveRegime', () => {
  it('EEA country resolves to opt_in (GPC not binding)', () => {
    expect(resolveRegime({ country: 'DE' })).toEqual({
      regime: 'opt_in',
      gpcBinding: false,
      doNotSell: false,
      showOptOutHonored: false,
    });
  });

  it('UK and Switzerland resolve to opt_in', () => {
    expect(resolveRegime({ country: 'GB' }).regime).toBe('opt_in');
    expect(resolveRegime({ country: 'CH' }).regime).toBe('opt_in');
  });

  it('California is opt_out_gpc with binding GPC, Do-Not-Sell, and opt-out-honored display', () => {
    expect(resolveRegime({ country: 'US', region: 'CA' })).toEqual({
      regime: 'opt_out_gpc',
      gpcBinding: true,
      doNotSell: true,
      showOptOutHonored: true,
    });
  });

  it('Texas is opt_out_gpc but does not require the opt-out-honored display', () => {
    const r = resolveRegime({ country: 'US', region: 'TX' });
    expect(r.regime).toBe('opt_out_gpc');
    expect(r.gpcBinding).toBe(true);
    expect(r.showOptOutHonored).toBe(false);
  });

  it('rest-of-US resolves to notice-only', () => {
    expect(resolveRegime({ country: 'US', region: 'WY' }).regime).toBe('notice');
  });

  it('unknown region fails safe to the strictest regime (opt_in)', () => {
    expect(resolveRegime({}).regime).toBe('opt_in');
    expect(resolveRegime({ country: 'ZZ' }).regime).toBe('opt_in');
  });

  it('is case-insensitive on country and region codes', () => {
    expect(resolveRegime({ country: 'us', region: 'ca' }).regime).toBe('opt_out_gpc');
  });
});
