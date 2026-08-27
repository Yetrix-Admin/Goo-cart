import type {Metadata} from "next";import "./globals.css";
export const metadata:Metadata={title:"Goocart — Everything local, one app",description:"Food, groceries, fresh produce, daily essentials, bike rides and parcels in one local super app.",icons:{icon:"/favicon.svg"}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
