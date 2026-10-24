import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./redesign.css";
import "./v041-design-theme.css";
import "./learn/v041-vocabulary.css";
import "./learn/audio-redesign.css";
import "./v041-app-redesign.css";
import "./learn/legal-pages.css";
import {PublicInfoBoundary} from "./learn/legal-pages";
export const metadata: Metadata = {title:"LANTERN · 微光托业",description:"每天一点微光。为你的目标安排托业听读、口语与复习。",manifest:"/manifest.webmanifest",appleWebApp:{capable:true,statusBarStyle:"black-translucent",title:"微光托业"},icons:{icon:"/phase2-theme/knight-icon-96.png",apple:"/phase2-theme/knight-icon-256.png"}};
export const viewport: Viewport = {width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#f5f0e7"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN" suppressHydrationWarning><body><PublicInfoBoundary>{children}</PublicInfoBoundary></body></html>}
