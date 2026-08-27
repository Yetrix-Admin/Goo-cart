// Initial catalog seeded into D1 on first migration. This is the authoritative
// source of restaurant/menu data — the mobile app and web app both read it over
// HTTP rather than bundling any of it. Rows are editable afterwards (admin
// panel / SQL) without shipping a new app build.
//
// Images are Unsplash photo IDs served through Unsplash's CDN, which is free to
// use commercially without attribution under the Unsplash License. Swap any
// `imageUrl` for a real photograph of the actual dish/restaurant when available.

const U = (id: string, w = 800) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;

export type SeedRestaurant = {
  id: string;
  name: string;
  imageUrl: string;
  rating: number;
  ratingCount: number;
  cuisines: string;
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  distanceKm: number;
  priceForOne: number;
  priceForTwo: number;
  vegOnly: number;
  isOpen: number;
  area: string;
  latitude: number;
  longitude: number;
};

export type SeedCategory = { id: string; restaurantId: string; name: string; sortOrder: number };

export type SeedFoodItem = {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  imageUrl: string;
  price: number;
  veg: number;
  rating: number;
  ratingCount: number;
  bestseller: number;
  available: number;
};

export type SeedOffer = { id: string; restaurantId: string; title: string; description: string | null };

export type SeedVariant = { id: string; foodItemId: string; name: string; price: number; sortOrder: number };

export type SeedAddonGroup = { id: string; foodItemId: string; name: string; required: number; multiSelect: number; maxSelect: number | null };

export type SeedAddon = { id: string; groupId: string; name: string; price: number };

export const SEED_RESTAURANTS: SeedRestaurant[] = [
  { id: "r1", name: "Paradise Biryani", imageUrl: U("1563379091339-03b21ab4a4f8"), rating: 4.5, ratingCount: 3200, cuisines: "Biryani,Indian,Chinese", deliveryTimeMin: 25, deliveryTimeMax: 30, distanceKm: 2.4, priceForOne: 200, priceForTwo: 400, vegOnly: 0, isOpen: 1, area: "Main Road, Jangareddigudem", latitude: 17.4368, longitude: 81.2668 },
  { id: "r2", name: "Sri Kanya Biryani", imageUrl: U("1633945274405-b6c8069047b0"), rating: 4.4, ratingCount: 2100, cuisines: "Biryani,Andhra", deliveryTimeMin: 30, deliveryTimeMax: 38, distanceKm: 3.0, priceForOne: 180, priceForTwo: 360, vegOnly: 0, isOpen: 1, area: "Bus Stand Road, Jangareddigudem", latitude: 17.4342, longitude: 81.2701 },
  { id: "r3", name: "Spicy Hub", imageUrl: U("1585032226651-759b368d7246"), rating: 4.2, ratingCount: 980, cuisines: "Chinese,Fast Food", deliveryTimeMin: 28, deliveryTimeMax: 35, distanceKm: 3.4, priceForOne: 220, priceForTwo: 440, vegOnly: 0, isOpen: 1, area: "Market Street, Jangareddigudem", latitude: 17.439, longitude: 81.263 },
  { id: "r4", name: "Food Palace", imageUrl: U("1517248135467-4c7edcad34c4"), rating: 4.1, ratingCount: 760, cuisines: "North Indian,Multi-cuisine", deliveryTimeMin: 32, deliveryTimeMax: 40, distanceKm: 4.1, priceForOne: 240, priceForTwo: 480, vegOnly: 0, isOpen: 1, area: "Ring Road, Jangareddigudem", latitude: 17.4321, longitude: 81.2588 },
  { id: "r5", name: "Village Kitchen", imageUrl: U("1596797038530-2c107229654b"), rating: 4.6, ratingCount: 1500, cuisines: "Andhra,Meals", deliveryTimeMin: 20, deliveryTimeMax: 28, distanceKm: 1.6, priceForOne: 150, priceForTwo: 280, vegOnly: 1, isOpen: 1, area: "Temple Street, Jangareddigudem", latitude: 17.4355, longitude: 81.2645 },
  { id: "r6", name: "Tiffin House", imageUrl: U("1630383249896-424e482df921"), rating: 4.4, ratingCount: 1900, cuisines: "South Indian,Breakfast", deliveryTimeMin: 16, deliveryTimeMax: 22, distanceKm: 1.1, priceForOne: 90, priceForTwo: 170, vegOnly: 1, isOpen: 1, area: "Station Road, Jangareddigudem", latitude: 17.4372, longitude: 81.2612 },
  { id: "r7", name: "Pizza Hub", imageUrl: U("1513104890138-7c749659a591"), rating: 4.0, ratingCount: 640, cuisines: "Pizza,Italian", deliveryTimeMin: 26, deliveryTimeMax: 34, distanceKm: 2.9, priceForOne: 210, priceForTwo: 420, vegOnly: 0, isOpen: 1, area: "College Road, Jangareddigudem", latitude: 17.4302, longitude: 81.2661 },
  { id: "r8", name: "Burger Point", imageUrl: U("1568901346375-23c9450c58cd"), rating: 4.1, ratingCount: 520, cuisines: "Burger,Fast Food", deliveryTimeMin: 18, deliveryTimeMax: 24, distanceKm: 1.9, priceForOne: 140, priceForTwo: 260, vegOnly: 0, isOpen: 1, area: "Market Street, Jangareddigudem", latitude: 17.4381, longitude: 81.2653 },
  { id: "r9", name: "Andhra Meals", imageUrl: U("1585937421612-70a008356fbe"), rating: 4.5, ratingCount: 2300, cuisines: "South Indian,Meals", deliveryTimeMin: 22, deliveryTimeMax: 28, distanceKm: 1.4, priceForOne: 130, priceForTwo: 250, vegOnly: 1, isOpen: 0, area: "Old Bus Stand, Jangareddigudem", latitude: 17.4335, longitude: 81.267 },
  { id: "r10", name: "Sweet Magic", imageUrl: U("1551024506-0bccd828d307"), rating: 4.3, ratingCount: 410, cuisines: "Desserts,Juices", deliveryTimeMin: 15, deliveryTimeMax: 20, distanceKm: 0.9, priceForOne: 80, priceForTwo: 150, vegOnly: 1, isOpen: 1, area: "Temple Street, Jangareddigudem", latitude: 17.436, longitude: 81.264 },
];

export const SEED_OFFERS: SeedOffer[] = [
  { id: "o1", restaurantId: "r1", title: "50% OFF up to ₹120", description: "Use code GOO50" },
  { id: "o2", restaurantId: "r1", title: "FREE DELIVERY", description: "On orders above ₹199" },
  { id: "o3", restaurantId: "r2", title: "₹100 OFF above ₹499", description: null },
  { id: "o4", restaurantId: "r4", title: "20% OFF up to ₹80", description: null },
  { id: "o5", restaurantId: "r5", title: "FREE DELIVERY", description: null },
  { id: "o6", restaurantId: "r7", title: "Buy 1 Get 1", description: null },
  { id: "o7", restaurantId: "r9", title: "10% OFF", description: null },
];

export const SEED_CATEGORIES: SeedCategory[] = [
  { id: "r1-recommended", restaurantId: "r1", name: "Recommended", sortOrder: 1 },
  { id: "r1-biryani", restaurantId: "r1", name: "Biryani", sortOrder: 2 },
  { id: "r1-starters", restaurantId: "r1", name: "Starters", sortOrder: 3 },
  { id: "r1-beverages", restaurantId: "r1", name: "Beverages", sortOrder: 4 },
  { id: "r2-biryani", restaurantId: "r2", name: "Biryani", sortOrder: 1 },
  { id: "r2-curries", restaurantId: "r2", name: "Curries", sortOrder: 2 },
  { id: "r2-beverages", restaurantId: "r2", name: "Beverages", sortOrder: 3 },
  { id: "r3-starters", restaurantId: "r3", name: "Starters", sortOrder: 1 },
  { id: "r3-noodles", restaurantId: "r3", name: "Noodles & Rice", sortOrder: 2 },
  { id: "r4-mains", restaurantId: "r4", name: "Main Course", sortOrder: 1 },
  { id: "r4-breads", restaurantId: "r4", name: "Breads", sortOrder: 2 },
  { id: "r5-meals", restaurantId: "r5", name: "Meals", sortOrder: 1 },
  { id: "r6-tiffins", restaurantId: "r6", name: "Tiffins", sortOrder: 1 },
  { id: "r7-pizza", restaurantId: "r7", name: "Pizza", sortOrder: 1 },
  { id: "r8-burgers", restaurantId: "r8", name: "Burgers", sortOrder: 1 },
  { id: "r9-meals", restaurantId: "r9", name: "Meals", sortOrder: 1 },
  { id: "r10-desserts", restaurantId: "r10", name: "Desserts", sortOrder: 1 },
  { id: "r10-juices", restaurantId: "r10", name: "Juices", sortOrder: 2 },
];

export const SEED_FOOD_ITEMS: SeedFoodItem[] = [
  { id: "f1", restaurantId: "r1", categoryId: "r1-biryani", name: "Chicken Dum Biryani", description: "Aromatic basmati rice slow-cooked with spiced chicken.", imageUrl: U("1563379091339-03b21ab4a4f8", 400), price: 220, veg: 0, rating: 4.6, ratingCount: 1200, bestseller: 1, available: 1 },
  { id: "f2", restaurantId: "r1", categoryId: "r1-biryani", name: "Veg Biryani", description: "Basmati rice cooked with fresh garden vegetables.", imageUrl: U("1596797038530-2c107229654b", 400), price: 180, veg: 1, rating: 4.3, ratingCount: 540, bestseller: 0, available: 1 },
  { id: "f3", restaurantId: "r1", categoryId: "r1-starters", name: "Chicken 65", description: "Spicy, deep-fried chicken bites tossed with curry leaves.", imageUrl: U("1567188040759-fb8a883dc6d8", 400), price: 190, veg: 0, rating: 4.4, ratingCount: 610, bestseller: 0, available: 1 },
  { id: "f4", restaurantId: "r1", categoryId: "r1-beverages", name: "Coke", description: "Chilled 300ml soft drink.", imageUrl: U("1554866585-cd94860890b7", 400), price: 40, veg: 1, rating: 0, ratingCount: 0, bestseller: 0, available: 1 },
  { id: "f5", restaurantId: "r2", categoryId: "r2-biryani", name: "Special Chicken Biryani", description: "Sri Kanya's signature slow-cooked chicken biryani.", imageUrl: U("1633945274405-b6c8069047b0", 400), price: 210, veg: 0, rating: 4.5, ratingCount: 890, bestseller: 1, available: 1 },
  { id: "f6", restaurantId: "r2", categoryId: "r2-curries", name: "Chicken Curry", description: "Home-style Andhra chicken curry served with steamed rice.", imageUrl: U("1565557623262-b51c2513a641", 400), price: 200, veg: 0, rating: 4.2, ratingCount: 300, bestseller: 0, available: 1 },
  { id: "f7", restaurantId: "r2", categoryId: "r2-beverages", name: "Sweet Lassi", description: "Chilled yogurt-based sweet drink.", imageUrl: U("1626196340104-2ba1a1b2b0b4", 400), price: 50, veg: 1, rating: 0, ratingCount: 0, bestseller: 0, available: 1 },
  { id: "f8", restaurantId: "r3", categoryId: "r3-starters", name: "Chilli Chicken", description: "Indo-Chinese chicken tossed with peppers and onion.", imageUrl: U("1626082927389-6cd097cdc6ec", 400), price: 210, veg: 0, rating: 4.3, ratingCount: 420, bestseller: 1, available: 1 },
  { id: "f9", restaurantId: "r3", categoryId: "r3-noodles", name: "Veg Fried Rice", description: "Wok-tossed rice with fresh vegetables.", imageUrl: U("1603133872878-684f208fb84b", 400), price: 160, veg: 1, rating: 4.0, ratingCount: 260, bestseller: 0, available: 1 },
  { id: "f10", restaurantId: "r4", categoryId: "r4-mains", name: "Paneer Butter Masala", description: "Cottage cheese in a rich, buttery tomato gravy.", imageUrl: U("1631452180519-c014fe946bc7", 400), price: 230, veg: 1, rating: 4.2, ratingCount: 380, bestseller: 0, available: 1 },
  { id: "f11", restaurantId: "r4", categoryId: "r4-breads", name: "Butter Naan", description: "Soft tandoor-baked bread brushed with butter.", imageUrl: U("1601050690597-df0568f70950", 400), price: 40, veg: 1, rating: 0, ratingCount: 0, bestseller: 0, available: 1 },
  { id: "f12", restaurantId: "r5", categoryId: "r5-meals", name: "Andhra Veg Meals", description: "Unlimited rice with traditional Andhra curries.", imageUrl: U("1585937421612-70a008356fbe", 400), price: 150, veg: 1, rating: 4.6, ratingCount: 900, bestseller: 1, available: 1 },
  { id: "f13", restaurantId: "r6", categoryId: "r6-tiffins", name: "Masala Dosa", description: "Crisp rice crepe filled with spiced potato masala.", imageUrl: U("1630383249896-424e482df921", 400), price: 70, veg: 1, rating: 4.5, ratingCount: 1100, bestseller: 1, available: 1 },
  { id: "f14", restaurantId: "r6", categoryId: "r6-tiffins", name: "Idli Sambar", description: "Steamed rice cakes served with sambar and chutney.", imageUrl: U("1589301760014-d929f3979dbc", 400), price: 60, veg: 1, rating: 4.4, ratingCount: 780, bestseller: 0, available: 1 },
  { id: "f15", restaurantId: "r7", categoryId: "r7-pizza", name: "Farmhouse Pizza", description: "Loaded with onion, capsicum, tomato and mushroom.", imageUrl: U("1513104890138-7c749659a591", 400), price: 250, veg: 1, rating: 4.1, ratingCount: 340, bestseller: 0, available: 1 },
  { id: "f16", restaurantId: "r8", categoryId: "r8-burgers", name: "Chicken Zinger Burger", description: "Crispy fried chicken burger with cheese and mayo.", imageUrl: U("1568901346375-23c9450c58cd", 400), price: 150, veg: 0, rating: 4.2, ratingCount: 290, bestseller: 1, available: 1 },
  { id: "f17", restaurantId: "r9", categoryId: "r9-meals", name: "Full Meals", description: "Rice, sambar, rasam, curry and papad.", imageUrl: U("1596797038530-2c107229654b", 400), price: 130, veg: 1, rating: 4.5, ratingCount: 640, bestseller: 0, available: 1 },
  { id: "f18", restaurantId: "r10", categoryId: "r10-desserts", name: "Gulab Jamun (2 pcs)", description: "Soft milk dumplings soaked in rose sugar syrup.", imageUrl: U("1601303516534-bf0b1eb70e63", 400), price: 60, veg: 1, rating: 4.4, ratingCount: 210, bestseller: 0, available: 1 },
  { id: "f19", restaurantId: "r10", categoryId: "r10-juices", name: "Fresh Mango Juice", description: "Seasonal mango blended fresh, no added sugar.", imageUrl: U("1546173159-315724a31696", 400), price: 70, veg: 1, rating: 4.3, ratingCount: 150, bestseller: 0, available: 0 },
];

export const SEED_VARIANTS: SeedVariant[] = [
  { id: "f1-regular", foodItemId: "f1", name: "Regular", price: 220, sortOrder: 1 },
  { id: "f1-large", foodItemId: "f1", name: "Large", price: 340, sortOrder: 2 },
  { id: "f5-regular", foodItemId: "f5", name: "Regular", price: 210, sortOrder: 1 },
  { id: "f5-large", foodItemId: "f5", name: "Large", price: 320, sortOrder: 2 },
  { id: "f15-regular", foodItemId: "f15", name: 'Regular (7")', price: 250, sortOrder: 1 },
  { id: "f15-medium", foodItemId: "f15", name: 'Medium (10")', price: 380, sortOrder: 2 },
  { id: "f15-large", foodItemId: "f15", name: 'Large (13")', price: 520, sortOrder: 3 },
];

export const SEED_ADDON_GROUPS: SeedAddonGroup[] = [
  { id: "f1-extras", foodItemId: "f1", name: "Add Extras", required: 0, multiSelect: 1, maxSelect: null },
  { id: "f5-extras", foodItemId: "f5", name: "Add Extras", required: 0, multiSelect: 1, maxSelect: null },
];

export const SEED_ADDONS: SeedAddon[] = [
  { id: "f1-egg", groupId: "f1-extras", name: "Boiled Egg", price: 20 },
  { id: "f1-chicken", groupId: "f1-extras", name: "Extra Chicken", price: 80 },
  { id: "f1-gravy", groupId: "f1-extras", name: "Extra Gravy", price: 30 },
  { id: "f5-egg", groupId: "f5-extras", name: "Boiled Egg", price: 20 },
  { id: "f5-raita", groupId: "f5-extras", name: "Raita", price: 25 },
];

export const SEED_COUPONS = [
  { code: "GOO50", title: "50% OFF up to ₹100", description: "Get 50% off, up to ₹100 off", type: "PERCENT", value: 50, minOrder: 299, maxDiscount: 100, active: 1 },
  { code: "FREEDEL", title: "Free delivery", description: "Free delivery on this order", type: "FREE_DELIVERY", value: 0, minOrder: 199, maxDiscount: null, active: 1 },
  { code: "WELCOME100", title: "₹100 OFF", description: "Flat ₹100 off your order", type: "FLAT", value: 100, minOrder: 499, maxDiscount: null, active: 1 },
];
