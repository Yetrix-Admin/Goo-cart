import type {Metadata} from "next";import "./globals.css";
export const metadata:Metadata={title:"Goocart — Everything local, one app",description:"Food, groceries, fresh produce, daily essentials, bike rides and parcels in one local super app.",icons:{icon:[{url:"/favicon-32.png",sizes:"32x32",type:"image/png"},{url:"/favicon.png",sizes:"48x48",type:"image/png"}],apple:"/apple-touch-icon.png"}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
