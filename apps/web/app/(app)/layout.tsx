import { AppChrome } from "@/components/layout/app-chrome";

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
  return <AppChrome>{children}</AppChrome>;
}
