import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { EmptyState } from "@/components/EmptyState";
import { OrderHistoryCard } from "@/components/OrderHistoryCard";
import { colors, radius, spacing, typography } from "@/theme";
import { useOrderStore } from "@/store/useOrderStore";
import { useReorder } from "@/hooks/useReorder";
import { ServiceType } from "@/types";
import { serviceOrderService, ServiceOrder } from "@/services/ServiceOrderService";

type ActivityTab = "ORDERS" | "RIDES" | "PARCELS";
type OrderFilter = "ALL" | ServiceType;

export default function ActivityScreen() {
  const [tab, setTab] = useState<ActivityTab>("ORDERS");
  const [filter, setFilter] = useState<OrderFilter>("ALL");
  const orders = useOrderStore((s) => s.orders);
  const loading = useOrderStore((s) => s.loading);
  const loadError = useOrderStore((s) => s.error);
  const refresh = useOrderStore((s) => s.refresh);
  const { reorder } = useReorder();
  const [serviceOrders,setServiceOrders]=useState<ServiceOrder[]>([]);
  const [serviceLoading,setServiceLoading]=useState(false);
  const [serviceError,setServiceError]=useState("");

  // Orders live on the server, so the list is re-fetched whenever this tab is
  // shown rather than trusting a local cache.
  const load = useCallback(() => {
    void refresh();
    setServiceLoading(true);
    serviceOrderService.activity().then((rows)=>{setServiceOrders(rows);setServiceError("");}).catch((e)=>setServiceError(e instanceof Error?e.message:"Could not load service activity")).finally(()=>setServiceLoading(false));
  }, [refresh]);

  useEffect(() => {
    load();
  }, [load]);

  const foodOrders = orders.filter((o) => o.serviceType === "FOOD");
  const visibleOrders = filter === "ALL" || filter === "FOOD" ? foodOrders : [];
  const visibleServiceOrders=serviceOrders.filter((o)=>tab==="RIDES"?o.service==="Bike Taxi":tab==="PARCELS"?o.service==="Parcel":["Grocery","Vegetables","Mart"].includes(o.service)&&(filter==="ALL"||o.service.toUpperCase()===filter));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={typography.h1}>Your activity</Text>
        <Text style={styles.copy}>Orders, bike rides and parcels in one timeline.</Text>
      </View>

      <View style={styles.tabRow}>
        {(["ORDERS", "RIDES", "PARCELS"] as ActivityTab[]).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[typography.captionStrong, tab === t && { color: colors.white }]}>{t === "ORDERS" ? "Orders" : t === "RIDES" ? "Bike Rides" : "Parcels"}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "ORDERS" && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {(["ALL", "FOOD", "GROCERY", "VEGETABLES", "MART"] as OrderFilter[]).map((f) => (
            <Pressable key={f} style={[styles.filterChip, filter === f && styles.filterChipActive]} onPress={() => setFilter(f)}>
              <Text style={[typography.captionStrong, filter === f && { color: colors.white }]}>{f[0] + f.slice(1).toLowerCase()}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={loading||serviceLoading} onRefresh={load} tintColor={colors.primary} />}>
        {tab === "ORDERS" ? (
          loadError||serviceError ? (
            <EmptyState icon="alert" title="Couldn't load your orders" copy={loadError||serviceError} />
          ) : visibleOrders.length === 0 && visibleServiceOrders.length===0 ? (
            <EmptyState icon="activity" title="No orders yet" copy="Once you place a food, grocery, vegetable or mart order, it will show up here." />
          ) : (
            <>{visibleOrders.map((order) => (
              <OrderHistoryCard
                key={order.id}
                order={order}
                onView={() => router.push({ pathname: "/orders/[id]", params: { id: order.id } })}
                onReorder={() => void reorder(order)}
              />
            ))}{visibleServiceOrders.map((order)=><ServiceActivityCard key={order.id} order={order}/>)}</>
          )
        ) : tab === "RIDES" ? (
          visibleServiceOrders.length?<>{visibleServiceOrders.map((order)=><ServiceActivityCard key={order.id} order={order}/>)}</>:<EmptyState icon="bike" title="No bike rides yet" copy="Book a ride from Home to see it here." />
        ) : (
          visibleServiceOrders.length?<>{visibleServiceOrders.map((order)=><ServiceActivityCard key={order.id} order={order}/>)}</>:<EmptyState icon="parcel" title="No parcels yet" copy="Send a parcel from Home to see it here." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ServiceActivityCard({order}:{order:ServiceOrder}){const code=String(order.details.verificationCode??"");return <Pressable style={styles.serviceCard} onPress={()=>router.push({pathname:"/service-orders/[id]",params:{id:order.id}})} accessibilityRole="button"><View><Text style={typography.captionStrong}>{order.service.toUpperCase()}</Text><Text style={typography.h3}>{order.reference}</Text><Text style={typography.caption}>{order.vendorName} • {order.status.replaceAll("_"," ")}</Text>{code?<Text style={styles.code}>Verification code: {code}</Text>:null}</View><Text style={typography.h3}>₹{order.total}</Text></Pressable>}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.xl, paddingBottom: spacing.md, gap: 4 },
  copy: { ...typography.body, color: colors.muted },
  tabRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.xl, marginBottom: spacing.sm },
  tab: { flex: 1, height: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: colors.dark, borderColor: colors.dark },
  filterRow: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  filterChip: { height: 32, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  list: { padding: spacing.xl, paddingTop: 0, gap: spacing.md, flexGrow: 1 },
  serviceCard:{flexDirection:"row",justifyContent:"space-between",gap:spacing.md,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:radius.lg,padding:spacing.lg},
  code:{...typography.captionStrong,color:colors.primary,marginTop:6},
});
