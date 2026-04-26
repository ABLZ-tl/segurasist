// X-Ray init stub. Hookea SDKs (AWS, http, postgres) cuando se llame en main.ts.
// En Sprint 0 no instrumentamos para no romper boot local sin daemon.

import AWSXRay from 'aws-xray-sdk-core';

export function initTracing(sampleRate: number, daemonAddress?: string): void {
  if (sampleRate <= 0) return;
  if (daemonAddress) {
    AWSXRay.setDaemonAddress(daemonAddress);
  }
  AWSXRay.middleware.setSamplingRules({
    version: 2,
    rules: [
      {
        description: 'default',
        host: '*',
        http_method: '*',
        url_path: '*',
        fixed_target: 0,
        rate: sampleRate,
      },
    ],
    default: { fixed_target: 0, rate: sampleRate },
  });
}
