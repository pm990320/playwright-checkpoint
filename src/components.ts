export type ScreenshotProps = {
  src: string;
  alt?: string;
  caption?: string;
};

export type StepListProps = {
  children?: unknown;
};

export type StepProps = {
  number: number;
  title: string;
  children?: unknown;
};

export type DeviceTabsProps = {
  children?: unknown;
};

export type DeviceTabProps = {
  label: string;
  children?: unknown;
};

export function Screenshot(_props: ScreenshotProps): null {
  return null;
}

export function StepList(_props: StepListProps): null {
  return null;
}

export function Step(_props: StepProps): null {
  return null;
}

export function DeviceTabs(_props: DeviceTabsProps): null {
  return null;
}

export function DeviceTab(_props: DeviceTabProps): null {
  return null;
}
