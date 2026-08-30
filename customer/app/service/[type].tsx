import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Icon } from "@/components/Icon";
import { PrimaryButton } from "@/components/PrimaryButton";
import { EmptyState } from "@/components/EmptyState";
import { RemoteImage } from "@/components/RemoteImage";
import { serviceMeta } from "@/constants/services";
import { FarePreview, serviceOrderService, ServicePricing, ServiceProduct } from "@/services/ServiceOrderService";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocationStore } from "@/store/useLocationStore";
import { useRideBookingStore } from "@/store/useRideBookingStore";
import { ServiceType } from "@/types";
import { colors, radius, spacing, typography } from "@/theme";

const API_KEY:Record<ServiceType,string>={FOOD:"FOOD",GROCERY:"GROCERY",VEGETABLES:"VEGETABLES",MART:"MART",BIKE_TAXI:"BIKE_TAXI",PARCEL:"PARCEL"};

export default function ServiceScreen(){
  const {type}=useLocalSearchParams<{type:ServiceType}>();
  const service=(type||"GROCERY") as ServiceType;
  const meta=serviceMeta(service);
  const user=useAuthStore((s)=>s.user);
  const location=useLocationStore((s)=>s.selected);
  const pickup=useRideBookingStore((s)=>s.pickup);
  const drop=useRideBookingStore((s)=>s.drop);
  const setPickup=useRideBookingStore((s)=>s.setPickup);
  const [products,setProducts]=useState<ServiceProduct[]|null>(null);
  const [pricing,setPricing]=useState<ServicePricing|null>(null);
  const [qty,setQty]=useState<Record<string,number>>({});
  const [packageType,setPackageType]=useState("Small package");
  const [preview,setPreview]=useState<FarePreview|null>(null);
  const [previewFor,setPreviewFor]=useState<string|null>(null);
  const [checkingFare,setCheckingFare]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const isJob=service==="BIKE_TAXI"||service==="PARCEL";
  const tripKey=`${pickup?.latitude},${pickup?.longitude}|${drop?.latitude},${drop?.longitude}`;
  const previewIsCurrent=preview!==null&&previewFor===tripKey;

  // Default pickup to the app's already-selected general location so a rider
  // who already set "Home"/"Work" doesn't have to place the pickup pin from
  // scratch — they can still tap to adjust it precisely on the map.
  useEffect(()=>{
    if(isJob&&!pickup&&location?.latitude!=null&&location.longitude!=null){
      setPickup({latitude:location.latitude,longitude:location.longitude,address:location.address||`${location.label}, ${location.city}`});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isJob,location]);

  useEffect(()=>{let cancelled=false;(async()=>{try{const config=await serviceOrderService.configuration();const enabled=config.services.find((row)=>row.key===API_KEY[service])?.enabled!==false;if(!enabled)throw new Error(`${meta.label} is temporarily unavailable.`);if(isJob){if(!cancelled)setPricing(config.pricing.find((row)=>row.service===meta.label)||null);}else{const rows=await serviceOrderService.products(API_KEY[service]);if(!cancelled)setProducts(rows);}setError("");}catch(e){if(!cancelled){setError(e instanceof Error?e.message:"Could not load this service");setProducts([]);}}})();return()=>{cancelled=true;};},[isJob,meta.label,service]);
  const selected=useMemo(()=>Object.entries(qty).filter(([,value])=>value>0),[qty]);
  const subtotal=selected.reduce((sum,[id,value])=>sum+(products?.find((p)=>p.id===id)?.price||0)*value,0);
  const change=(id:string,by:number)=>setQty((current)=>({...current,[id]:Math.max(0,Math.min(20,(current[id]||0)+by))}));

  // Distance and fare are never guessed on-device — the server calculates
  // them from the map-picked pickup/drop coordinates, so what's shown here
  // is exactly what booking will charge.
  const checkFare=async()=>{
    if(!pickup||!drop){setError("Set both a pickup and drop location.");return;}
    setCheckingFare(true);setError("");
    try{
      const result=await serviceOrderService.farePreview(API_KEY[service],pickup.address,drop.address,pickup,drop);
      setPreview(result);setPreviewFor(tripKey);
    }catch(e){setPreview(null);setPreviewFor(null);setError(e instanceof Error?e.message:"Could not calculate a fare for these locations");}
    finally{setCheckingFare(false);}
  };

  const book=async()=>{
    if(!user){router.push({pathname:"/login",params:{returnTo:`/service/${service}`}});return;}
    if(isJob&&(!pickup||!drop)){setError("Set both a pickup and drop location.");return;}
    setBusy(true);setError("");
    try{
      const order=isJob
        ?await serviceOrderService.place({
            service:API_KEY[service],pickup:pickup!.address,drop:drop!.address,packageType,
            pickupLatitude:pickup!.latitude,pickupLongitude:pickup!.longitude,
            dropLatitude:drop!.latitude,dropLongitude:drop!.longitude,
          })
        :await serviceOrderService.place({service:API_KEY[service],items:selected.map(([productId,quantity])=>({productId,quantity})),address:location});
      Alert.alert("Confirmed",`${order.reference} has been created for ₹${order.total}.`,[{text:"View activity",onPress:()=>router.replace("/(tabs)/activity")}]);
      setQty({});setPreview(null);setPreviewFor(null);
    }catch(e){setError(e instanceof Error?e.message:"Could not place this request");}
    finally{setBusy(false);}
  };

  return <SafeAreaView style={styles.safe} edges={["top"]}><View style={styles.header}><Pressable onPress={()=>router.back()} accessibilityLabel="Back"><Icon name="back" size={22} color={colors.text}/></Pressable><View><Text style={typography.h2}>{meta.label}</Text><Text style={typography.caption}>Live pricing and availability from Goocart admin</Text></View></View><KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":"height"} style={{flex:1}}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {error?<Text style={styles.error}>{error}</Text>:null}
    {isJob?<View style={styles.card}>
      <LocationRow label="Pickup" value={pickup} onPress={()=>{setPreview(null);router.push({pathname:"/location-picker",params:{field:"pickup"}});}}/>
      <LocationRow label="Drop" value={drop} onPress={()=>{setPreview(null);router.push({pathname:"/location-picker",params:{field:"drop"}});}}/>
      {service==="PARCEL"?<Field label="Package type" value={packageType} onChangeText={setPackageType}/>:null}
      <PrimaryButton label={checkingFare?"Checking…":"Check fare"} variant="outline" onPress={()=>void checkFare()} disabled={checkingFare||!pricing}/>
      {previewIsCurrent&&preview?<View style={styles.quote}>
        <View>
          <Text style={typography.caption}>{preview.distanceKm} km • ₹{preview.baseFare} base + ₹{preview.perKm}/km + ₹{preview.platformFee} fee</Text>
          <Text style={typography.h2}>₹{preview.total}</Text>
        </View>
      </View>:<Text style={typography.caption}>Check the fare before booking — distance is calculated from your addresses.</Text>}
      <PrimaryButton label={busy?"Booking…":user?`Book ${meta.label}`:"Sign in to book"} onPress={()=>void book()} disabled={busy||!previewIsCurrent}/>
    </View>:
    products===null?<Text style={typography.body}>Loading live products…</Text>:products.length===0?<EmptyState icon={meta.icon} title={`No ${meta.label.toLowerCase()} items available`} copy="Admin can add products and stock from the Catalog page."/>:<><Text style={typography.eyebrow}>AVAILABLE NOW</Text>{products.map((product)=><View key={product.id} style={styles.product}><RemoteImage uri={product.imageUrl} fallbackLabel={product.name} style={styles.productImage}/><View style={{flex:1}}><Text style={typography.bodyStrong}>{product.name}</Text><Text style={typography.caption}>{product.vendorName} • {product.description||product.eta}</Text><Text style={styles.price}>₹{product.price} • {product.stock} in stock</Text></View><View style={styles.stepper}><Pressable onPress={()=>change(product.id,-1)}><Text style={styles.step}>−</Text></Pressable><Text style={typography.bodyStrong}>{qty[product.id]||0}</Text><Pressable onPress={()=>change(product.id,1)}><Text style={styles.step}>+</Text></Pressable></View></View>)}<View style={styles.checkout}><View><Text style={typography.caption}>{selected.length} selected</Text><Text style={typography.h3}>Subtotal ₹{subtotal}</Text></View><PrimaryButton label={busy?"Placing…":user?"Place order":"Sign in"} onPress={()=>void book()} disabled={busy||selected.length===0}/></View></>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function Field({label,...props}:{label:string}&React.ComponentProps<typeof TextInput>){return <View style={styles.field}><Text style={typography.captionStrong}>{label}</Text><TextInput style={styles.input} placeholderTextColor={colors.muted} {...props}/></View>}

// Tappable row that opens the map-based picker (location-picker.tsx) instead
// of free-typed text — the Rapido/Ola-style pin-on-a-map flow, and the
// coordinates it returns are exact, so the server never has to guess an
// address's location from text.
function LocationRow({label,value,onPress}:{label:string;value:{address:string}|null;onPress:()=>void}){
  return <Pressable style={styles.locationRow} onPress={onPress} accessibilityRole="button">
    <View style={[styles.locationDot,label==="Drop"&&styles.locationDotDrop]}/>
    <View style={{flex:1}}>
      <Text style={typography.captionStrong}>{label}</Text>
      <Text style={value?styles.locationValue:styles.locationPlaceholder} numberOfLines={1}>{value?value.address:`Tap to set ${label.toLowerCase()} location`}</Text>
    </View>
    <Icon name="forward" size={18} color={colors.muted}/>
  </Pressable>;
}

const styles=StyleSheet.create({safe:{flex:1,backgroundColor:colors.background},header:{flexDirection:"row",alignItems:"center",gap:spacing.md,padding:spacing.xl,backgroundColor:colors.surface,borderBottomWidth:1,borderBottomColor:colors.border},content:{padding:spacing.xl,gap:spacing.md,paddingBottom:120},card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:radius.lg,padding:spacing.lg,gap:spacing.md},field:{gap:6},input:{height:48,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,paddingHorizontal:spacing.md,color:colors.text,backgroundColor:colors.background},locationRow:{flexDirection:"row",alignItems:"center",gap:spacing.md,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,padding:spacing.md,backgroundColor:colors.background},locationDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.primary},locationDotDrop:{backgroundColor:colors.dark,borderRadius:2},locationValue:{...typography.body,color:colors.text,marginTop:2},locationPlaceholder:{...typography.body,color:colors.muted,marginTop:2},quote:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:colors.primaryMuted,borderRadius:radius.md,padding:spacing.md},product:{flexDirection:"row",alignItems:"center",gap:spacing.md,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,padding:spacing.lg},productImage:{width:56,height:56,borderRadius:radius.sm},price:{...typography.captionStrong,color:colors.primary,marginTop:5},stepper:{flexDirection:"row",alignItems:"center",gap:spacing.md},step:{fontSize:22,color:colors.primary,fontWeight:"800",padding:6},checkout:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.md,backgroundColor:colors.dark,borderRadius:radius.lg,padding:spacing.lg},error:{...typography.caption,color:colors.error}});
