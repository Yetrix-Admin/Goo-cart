import { FoodCategory } from "@/types";

// Unsplash-hosted category imagery (free for commercial use, no attribution
// required). Small crops keep the "What's on your mind?" row light to load.
const img = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=220&h=220&q=65`;

export const FOOD_CATEGORIES: FoodCategory[] = [
  { id: "biryani", name: "Biryani", imageUrl: img("1563379091339-03b21ab4a4f8") },
  { id: "pizza", name: "Pizza", imageUrl: img("1513104890138-7c749659a591") },
  { id: "burger", name: "Burger", imageUrl: img("1568901346375-23c9450c58cd") },
  { id: "dosa", name: "Dosa", imageUrl: img("1630383249896-424e482df921") },
  { id: "chicken", name: "Chicken", imageUrl: img("1567188040759-fb8a883dc6d8") },
  { id: "meals", name: "Meals", imageUrl: img("1585937421612-70a008356fbe") },
  { id: "chinese", name: "Chinese", imageUrl: img("1585032226651-759b368d7246") },
  { id: "desserts", name: "Desserts", imageUrl: img("1551024506-0bccd828d307") },
  { id: "juices", name: "Juices", imageUrl: img("1546173159-315724a31696") },
  { id: "south_indian", name: "South Indian", imageUrl: img("1589301760014-d929f3979dbc") },
];
