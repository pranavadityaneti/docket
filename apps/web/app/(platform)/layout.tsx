import { PlatformChrome } from "@/components/layout/platform-chrome";

export default function PlatformSectionLayout({ children }: { children: React.ReactNode }) {
  return <PlatformChrome>{children}</PlatformChrome>;
}
