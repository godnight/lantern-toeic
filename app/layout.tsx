import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./redesign.css";
export const metadata: Metadata = {title:"LANTERN · 微光托业",description:"每天一点微光。为你的目标安排托业听读、口语与复习。",manifest:"/manifest.webmanifest",appleWebApp:{capable:true,statusBarStyle:"black-translucent",title:"微光托业"},icons:{icon:"/favicon.svg",apple:"/icons/icon-192.png"}};
export const viewport: Viewport = {width:"device-width",initialScale:1,viewportFit:"cover",themeColor:"#f5f4f0"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN" suppressHydrationWarning><body>{children}</body></html>}
