import type { TestInfo } from '@playwright/test';

export type DeviceSurface = 'desktop' | 'mobile';

export type DeviceProfile = {
  name: string;
  isMobile: boolean;
  surface: DeviceSurface;
};

export function createDeviceProfile(testInfo: TestInfo): DeviceProfile {
  const use = testInfo.project.use as { isMobile?: boolean } | undefined;
  const isMobile = Boolean(use?.isMobile);

  return {
    name: testInfo.project.name,
    isMobile,
    surface: isMobile ? 'mobile' : 'desktop',
  };
}
