// AUTO-DERIVED from db/catalogSeed.ts by convert-seed.mjs — the same catalog
// the D1 build used, reshaped for MongoDB (categories, offers, variants and
// add-on groups embedded in their parent document).
//
// Images are Unsplash CDN URLs, free for commercial use without attribution.
// Replace any imageUrl with a real photograph when you have one.

export const SERVICES = ["Food","Grocery","Vegetables","Mart","Bike Taxi","Parcel"];

export const SEED_ROLES = [
  {
    "id": "CUSTOMER",
    "label": "Customer",
    "description": "Orders food, groceries and books rides or parcels.",
    "permissions": []
  },
  {
    "id": "VENDOR_OWNER",
    "label": "Vendor Owner",
    "description": "Owns and fully manages a store.",
    "permissions": [
      "product.manage_own",
      "order.manage_own_vendor"
    ]
  },
  {
    "id": "VENDOR_MANAGER",
    "label": "Vendor Manager",
    "description": "Manages day-to-day store operations.",
    "permissions": [
      "product.manage_own",
      "order.manage_own_vendor"
    ]
  },
  {
    "id": "DELIVERY_PARTNER",
    "label": "Delivery Partner",
    "description": "Delivers orders, parcels and rides.",
    "permissions": [
      "order.manage_own_partner"
    ]
  },
  {
    "id": "SUPER_ADMIN",
    "label": "Super Admin",
    "description": "Full platform access.",
    "permissions": [
      "*"
    ]
  },
  {
    "id": "OPERATIONS_ADMIN",
    "label": "Operations Admin",
    "description": "Runs live operations.",
    "permissions": [
      "order.manage_all",
      "order.cancel_any",
      "service.manage",
      "vendor.manage",
      "partner.manage",
      "audit.view"
    ]
  },
  {
    "id": "FINANCE_ADMIN",
    "label": "Finance Admin",
    "description": "Pricing, commissions and settlements.",
    "permissions": [
      "pricing.manage",
      "settlement.manage",
      "audit.view"
    ]
  },
  {
    "id": "SUPPORT_ADMIN",
    "label": "Support Admin",
    "description": "Support tickets and disputes.",
    "permissions": [
      "support.manage",
      "order.manage_all",
      "audit.view"
    ]
  },
  {
    "id": "MARKETING_ADMIN",
    "label": "Marketing Admin",
    "description": "Offers, coupons and campaigns.",
    "permissions": [
      "audit.view"
    ]
  },
  {
    "id": "CITY_ADMIN",
    "label": "City Admin",
    "description": "Manages a city service area.",
    "permissions": [
      "service.manage",
      "vendor.manage",
      "partner.manage",
      "audit.view"
    ]
  }
];

export const SEED_RESTAURANTS = [
  {
    "slug": "r1",
    "name": "Paradise Biryani",
    "imageUrl": "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=800&q=70",
    "rating": 4.5,
    "ratingCount": 3200,
    "cuisines": [
      "Biryani",
      "Indian",
      "Chinese"
    ],
    "deliveryTimeMin": 25,
    "deliveryTimeMax": 30,
    "distanceKm": 2.4,
    "priceForOne": 200,
    "priceForTwo": 400,
    "vegOnly": false,
    "isOpen": true,
    "area": "Main Road, Jangareddigudem",
    "latitude": 17.4368,
    "longitude": 81.2668,
    "offers": [
      {
        "title": "50% OFF up to ₹120",
        "description": "Use code GOO50"
      },
      {
        "title": "FREE DELIVERY",
        "description": "On orders above ₹199"
      }
    ],
    "categories": [
      {
        "key": "r1-recommended",
        "name": "Recommended",
        "sortOrder": 1
      },
      {
        "key": "r1-biryani",
        "name": "Biryani",
        "sortOrder": 2
      },
      {
        "key": "r1-starters",
        "name": "Starters",
        "sortOrder": 3
      },
      {
        "key": "r1-beverages",
        "name": "Beverages",
        "sortOrder": 4
      }
    ]
  },
  {
    "slug": "r2",
    "name": "Sri Kanya Biryani",
    "imageUrl": "https://images.unsplash.com/photo-1633945274405-b6c8069047b0?auto=format&fit=crop&w=800&q=70",
    "rating": 4.4,
    "ratingCount": 2100,
    "cuisines": [
      "Biryani",
      "Andhra"
    ],
    "deliveryTimeMin": 30,
    "deliveryTimeMax": 38,
    "distanceKm": 3,
    "priceForOne": 180,
    "priceForTwo": 360,
    "vegOnly": false,
    "isOpen": true,
    "area": "Bus Stand Road, Jangareddigudem",
    "latitude": 17.4342,
    "longitude": 81.2701,
    "offers": [
      {
        "title": "₹100 OFF above ₹499",
        "description": null
      }
    ],
    "categories": [
      {
        "key": "r2-biryani",
        "name": "Biryani",
        "sortOrder": 1
      },
      {
        "key": "r2-curries",
        "name": "Curries",
        "sortOrder": 2
      },
      {
        "key": "r2-beverages",
        "name": "Beverages",
        "sortOrder": 3
      }
    ]
  },
  {
    "slug": "r3",
    "name": "Spicy Hub",
    "imageUrl": "https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=800&q=70",
    "rating": 4.2,
    "ratingCount": 980,
    "cuisines": [
      "Chinese",
      "Fast Food"
    ],
    "deliveryTimeMin": 28,
    "deliveryTimeMax": 35,
    "distanceKm": 3.4,
    "priceForOne": 220,
    "priceForTwo": 440,
    "vegOnly": false,
    "isOpen": true,
    "area": "Market Street, Jangareddigudem",
    "latitude": 17.439,
    "longitude": 81.263,
    "offers": [],
    "categories": [
      {
        "key": "r3-starters",
        "name": "Starters",
        "sortOrder": 1
      },
      {
        "key": "r3-noodles",
        "name": "Noodles & Rice",
        "sortOrder": 2
      }
    ]
  },
  {
    "slug": "r4",
    "name": "Food Palace",
    "imageUrl": "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=70",
    "rating": 4.1,
    "ratingCount": 760,
    "cuisines": [
      "North Indian",
      "Multi-cuisine"
    ],
    "deliveryTimeMin": 32,
    "deliveryTimeMax": 40,
    "distanceKm": 4.1,
    "priceForOne": 240,
    "priceForTwo": 480,
    "vegOnly": false,
    "isOpen": true,
    "area": "Ring Road, Jangareddigudem",
    "latitude": 17.4321,
    "longitude": 81.2588,
    "offers": [
      {
        "title": "20% OFF up to ₹80",
        "description": null
      }
    ],
    "categories": [
      {
        "key": "r4-mains",
        "name": "Main Course",
        "sortOrder": 1
      },
      {
        "key": "r4-breads",
        "name": "Breads",
        "sortOrder": 2
      }
    ]
  },
  {
    "slug": "r5",
    "name": "Village Kitchen",
    "imageUrl": "https://images.unsplash.com/photo-1596797038530-2c107229654b?auto=format&fit=crop&w=800&q=70",
    "rating": 4.6,
    "ratingCount": 1500,
    "cuisines": [
      "Andhra",
      "Meals"
    ],
    "deliveryTimeMin": 20,
    "deliveryTimeMax": 28,
    "distanceKm": 1.6,
    "priceForOne": 150,
    "priceForTwo": 280,
    "vegOnly": true,
    "isOpen": true,
    "area": "Temple Street, Jangareddigudem",
    "latitude": 17.4355,
    "longitude": 81.2645,
    "offers": [
      {
        "title": "FREE DELIVERY",
        "description": null
      }
    ],
    "categories": [
      {
        "key": "r5-meals",
        "name": "Meals",
        "sortOrder": 1
      }
    ]
  },
  {
    "slug": "r6",
    "name": "Tiffin House",
    "imageUrl": "https://images.unsplash.com/photo-1630383249896-424e482df921?auto=format&fit=crop&w=800&q=70",
    "rating": 4.4,
    "ratingCount": 1900,
    "cuisines": [
      "South Indian",
      "Breakfast"
    ],
    "deliveryTimeMin": 16,
    "deliveryTimeMax": 22,
    "distanceKm": 1.1,
    "priceForOne": 90,
    "priceForTwo": 170,
    "vegOnly": true,
    "isOpen": true,
    "area": "Station Road, Jangareddigudem",
    "latitude": 17.4372,
    "longitude": 81.2612,
    "offers": [],
    "categories": [
      {
        "key": "r6-tiffins",
        "name": "Tiffins",
        "sortOrder": 1
      }
    ]
  },
  {
    "slug": "r7",
    "name": "Pizza Hub",
    "imageUrl": "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=70",
    "rating": 4,
    "ratingCount": 640,
    "cuisines": [
      "Pizza",
      "Italian"
    ],
    "deliveryTimeMin": 26,
    "deliveryTimeMax": 34,
    "distanceKm": 2.9,
    "priceForOne": 210,
    "priceForTwo": 420,
    "vegOnly": false,
    "isOpen": true,
    "area": "College Road, Jangareddigudem",
    "latitude": 17.4302,
    "longitude": 81.2661,
    "offers": [
      {
        "title": "Buy 1 Get 1",
        "description": null
      }
    ],
    "categories": [
      {
        "key": "r7-pizza",
        "name": "Pizza",
        "sortOrder": 1
      }
    ]
  },
  {
    "slug": "r8",
    "name": "Burger Point",
    "imageUrl": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=800&q=70",
    "rating": 4.1,
    "ratingCount": 520,
    "cuisines": [
      "Burger",
      "Fast Food"
    ],
    "deliveryTimeMin": 18,
    "deliveryTimeMax": 24,
    "distanceKm": 1.9,
    "priceForOne": 140,
    "priceForTwo": 260,
    "vegOnly": false,
    "isOpen": true,
    "area": "Market Street, Jangareddigudem",
    "latitude": 17.4381,
    "longitude": 81.2653,
    "offers": [],
    "categories": [
      {
        "key": "r8-burgers",
        "name": "Burgers",
        "sortOrder": 1
      }
    ]
  },
  {
    "slug": "r9",
    "name": "Andhra Meals",
    "imageUrl": "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=800&q=70",
    "rating": 4.5,
    "ratingCount": 2300,
    "cuisines": [
      "South Indian",
      "Meals"
    ],
    "deliveryTimeMin": 22,
    "deliveryTimeMax": 28,
    "distanceKm": 1.4,
    "priceForOne": 130,
    "priceForTwo": 250,
    "vegOnly": true,
    "isOpen": false,
    "area": "Old Bus Stand, Jangareddigudem",
    "latitude": 17.4335,
    "longitude": 81.267,
    "offers": [
      {
        "title": "10% OFF",
        "description": null
      }
    ],
    "categories": [
      {
        "key": "r9-meals",
        "name": "Meals",
        "sortOrder": 1
      }
    ]
  },
  {
    "slug": "r10",
    "name": "Sweet Magic",
    "imageUrl": "https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=800&q=70",
    "rating": 4.3,
    "ratingCount": 410,
    "cuisines": [
      "Desserts",
      "Juices"
    ],
    "deliveryTimeMin": 15,
    "deliveryTimeMax": 20,
    "distanceKm": 0.9,
    "priceForOne": 80,
    "priceForTwo": 150,
    "vegOnly": true,
    "isOpen": true,
    "area": "Temple Street, Jangareddigudem",
    "latitude": 17.436,
    "longitude": 81.264,
    "offers": [],
    "categories": [
      {
        "key": "r10-desserts",
        "name": "Desserts",
        "sortOrder": 1
      },
      {
        "key": "r10-juices",
        "name": "Juices",
        "sortOrder": 2
      }
    ]
  }
];

export const SEED_FOOD_ITEMS = [
  {
    "slug": "f1",
    "restaurantSlug": "r1",
    "categoryKey": "r1-biryani",
    "name": "Chicken Dum Biryani",
    "description": "Aromatic basmati rice slow-cooked with spiced chicken.",
    "imageUrl": "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=400&q=70",
    "price": 220,
    "veg": false,
    "rating": 4.6,
    "ratingCount": 1200,
    "bestseller": true,
    "available": true,
    "variants": [
      {
        "key": "f1-regular",
        "name": "Regular",
        "price": 220,
        "sortOrder": 1
      },
      {
        "key": "f1-large",
        "name": "Large",
        "price": 340,
        "sortOrder": 2
      }
    ],
    "addonGroups": [
      {
        "key": "f1-extras",
        "name": "Add Extras",
        "required": false,
        "multiSelect": true,
        "maxSelect": null,
        "options": [
          {
            "key": "f1-egg",
            "name": "Boiled Egg",
            "price": 20
          },
          {
            "key": "f1-chicken",
            "name": "Extra Chicken",
            "price": 80
          },
          {
            "key": "f1-gravy",
            "name": "Extra Gravy",
            "price": 30
          }
        ]
      }
    ]
  },
  {
    "slug": "f2",
    "restaurantSlug": "r1",
    "categoryKey": "r1-biryani",
    "name": "Veg Biryani",
    "description": "Basmati rice cooked with fresh garden vegetables.",
    "imageUrl": "https://images.unsplash.com/photo-1596797038530-2c107229654b?auto=format&fit=crop&w=400&q=70",
    "price": 180,
    "veg": true,
    "rating": 4.3,
    "ratingCount": 540,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f3",
    "restaurantSlug": "r1",
    "categoryKey": "r1-starters",
    "name": "Chicken 65",
    "description": "Spicy, deep-fried chicken bites tossed with curry leaves.",
    "imageUrl": "https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?auto=format&fit=crop&w=400&q=70",
    "price": 190,
    "veg": false,
    "rating": 4.4,
    "ratingCount": 610,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f4",
    "restaurantSlug": "r1",
    "categoryKey": "r1-beverages",
    "name": "Coke",
    "description": "Chilled 300ml soft drink.",
    "imageUrl": "https://images.unsplash.com/photo-1554866585-cd94860890b7?auto=format&fit=crop&w=400&q=70",
    "price": 40,
    "veg": true,
    "rating": 0,
    "ratingCount": 0,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f5",
    "restaurantSlug": "r2",
    "categoryKey": "r2-biryani",
    "name": "Special Chicken Biryani",
    "description": "Sri Kanya's signature slow-cooked chicken biryani.",
    "imageUrl": "https://images.unsplash.com/photo-1633945274405-b6c8069047b0?auto=format&fit=crop&w=400&q=70",
    "price": 210,
    "veg": false,
    "rating": 4.5,
    "ratingCount": 890,
    "bestseller": true,
    "available": true,
    "variants": [
      {
        "key": "f5-regular",
        "name": "Regular",
        "price": 210,
        "sortOrder": 1
      },
      {
        "key": "f5-large",
        "name": "Large",
        "price": 320,
        "sortOrder": 2
      }
    ],
    "addonGroups": [
      {
        "key": "f5-extras",
        "name": "Add Extras",
        "required": false,
        "multiSelect": true,
        "maxSelect": null,
        "options": [
          {
            "key": "f5-egg",
            "name": "Boiled Egg",
            "price": 20
          },
          {
            "key": "f5-raita",
            "name": "Raita",
            "price": 25
          }
        ]
      }
    ]
  },
  {
    "slug": "f6",
    "restaurantSlug": "r2",
    "categoryKey": "r2-curries",
    "name": "Chicken Curry",
    "description": "Home-style Andhra chicken curry served with steamed rice.",
    "imageUrl": "https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=400&q=70",
    "price": 200,
    "veg": false,
    "rating": 4.2,
    "ratingCount": 300,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f7",
    "restaurantSlug": "r2",
    "categoryKey": "r2-beverages",
    "name": "Sweet Lassi",
    "description": "Chilled yogurt-based sweet drink.",
    "imageUrl": "https://images.unsplash.com/photo-1626196340104-2ba1a1b2b0b4?auto=format&fit=crop&w=400&q=70",
    "price": 50,
    "veg": true,
    "rating": 0,
    "ratingCount": 0,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f8",
    "restaurantSlug": "r3",
    "categoryKey": "r3-starters",
    "name": "Chilli Chicken",
    "description": "Indo-Chinese chicken tossed with peppers and onion.",
    "imageUrl": "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=400&q=70",
    "price": 210,
    "veg": false,
    "rating": 4.3,
    "ratingCount": 420,
    "bestseller": true,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f9",
    "restaurantSlug": "r3",
    "categoryKey": "r3-noodles",
    "name": "Veg Fried Rice",
    "description": "Wok-tossed rice with fresh vegetables.",
    "imageUrl": "https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=400&q=70",
    "price": 160,
    "veg": true,
    "rating": 4,
    "ratingCount": 260,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f10",
    "restaurantSlug": "r4",
    "categoryKey": "r4-mains",
    "name": "Paneer Butter Masala",
    "description": "Cottage cheese in a rich, buttery tomato gravy.",
    "imageUrl": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=400&q=70",
    "price": 230,
    "veg": true,
    "rating": 4.2,
    "ratingCount": 380,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f11",
    "restaurantSlug": "r4",
    "categoryKey": "r4-breads",
    "name": "Butter Naan",
    "description": "Soft tandoor-baked bread brushed with butter.",
    "imageUrl": "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=400&q=70",
    "price": 40,
    "veg": true,
    "rating": 0,
    "ratingCount": 0,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f12",
    "restaurantSlug": "r5",
    "categoryKey": "r5-meals",
    "name": "Andhra Veg Meals",
    "description": "Unlimited rice with traditional Andhra curries.",
    "imageUrl": "https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=400&q=70",
    "price": 150,
    "veg": true,
    "rating": 4.6,
    "ratingCount": 900,
    "bestseller": true,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f13",
    "restaurantSlug": "r6",
    "categoryKey": "r6-tiffins",
    "name": "Masala Dosa",
    "description": "Crisp rice crepe filled with spiced potato masala.",
    "imageUrl": "https://images.unsplash.com/photo-1630383249896-424e482df921?auto=format&fit=crop&w=400&q=70",
    "price": 70,
    "veg": true,
    "rating": 4.5,
    "ratingCount": 1100,
    "bestseller": true,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f14",
    "restaurantSlug": "r6",
    "categoryKey": "r6-tiffins",
    "name": "Idli Sambar",
    "description": "Steamed rice cakes served with sambar and chutney.",
    "imageUrl": "https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=400&q=70",
    "price": 60,
    "veg": true,
    "rating": 4.4,
    "ratingCount": 780,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f15",
    "restaurantSlug": "r7",
    "categoryKey": "r7-pizza",
    "name": "Farmhouse Pizza",
    "description": "Loaded with onion, capsicum, tomato and mushroom.",
    "imageUrl": "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=400&q=70",
    "price": 250,
    "veg": true,
    "rating": 4.1,
    "ratingCount": 340,
    "bestseller": false,
    "available": true,
    "variants": [
      {
        "key": "f15-regular",
        "name": "Regular (7\")",
        "price": 250,
        "sortOrder": 1
      },
      {
        "key": "f15-medium",
        "name": "Medium (10\")",
        "price": 380,
        "sortOrder": 2
      },
      {
        "key": "f15-large",
        "name": "Large (13\")",
        "price": 520,
        "sortOrder": 3
      }
    ],
    "addonGroups": []
  },
  {
    "slug": "f16",
    "restaurantSlug": "r8",
    "categoryKey": "r8-burgers",
    "name": "Chicken Zinger Burger",
    "description": "Crispy fried chicken burger with cheese and mayo.",
    "imageUrl": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=400&q=70",
    "price": 150,
    "veg": false,
    "rating": 4.2,
    "ratingCount": 290,
    "bestseller": true,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f17",
    "restaurantSlug": "r9",
    "categoryKey": "r9-meals",
    "name": "Full Meals",
    "description": "Rice, sambar, rasam, curry and papad.",
    "imageUrl": "https://images.unsplash.com/photo-1596797038530-2c107229654b?auto=format&fit=crop&w=400&q=70",
    "price": 130,
    "veg": true,
    "rating": 4.5,
    "ratingCount": 640,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f18",
    "restaurantSlug": "r10",
    "categoryKey": "r10-desserts",
    "name": "Gulab Jamun (2 pcs)",
    "description": "Soft milk dumplings soaked in rose sugar syrup.",
    "imageUrl": "https://images.unsplash.com/photo-1601303516534-bf0b1eb70e63?auto=format&fit=crop&w=400&q=70",
    "price": 60,
    "veg": true,
    "rating": 4.4,
    "ratingCount": 210,
    "bestseller": false,
    "available": true,
    "variants": [],
    "addonGroups": []
  },
  {
    "slug": "f19",
    "restaurantSlug": "r10",
    "categoryKey": "r10-juices",
    "name": "Fresh Mango Juice",
    "description": "Seasonal mango blended fresh, no added sugar.",
    "imageUrl": "https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=400&q=70",
    "price": 70,
    "veg": true,
    "rating": 4.3,
    "ratingCount": 150,
    "bestseller": false,
    "available": false,
    "variants": [],
    "addonGroups": []
  }
];

export const SEED_COUPONS = [
  {
    "code": "GOO50",
    "title": "50% OFF up to ₹100",
    "description": "Get 50% off, up to ₹100 off",
    "type": "PERCENT",
    "value": 50,
    "minOrder": 299,
    "maxDiscount": 100,
    "active": true
  },
  {
    "code": "FREEDEL",
    "title": "Free delivery",
    "description": "Free delivery on this order",
    "type": "FREE_DELIVERY",
    "value": 0,
    "minOrder": 199,
    "maxDiscount": null,
    "active": true
  },
  {
    "code": "WELCOME100",
    "title": "₹100 OFF",
    "description": "Flat ₹100 off your order",
    "type": "FLAT",
    "value": 100,
    "minOrder": 499,
    "maxDiscount": null,
    "active": true
  }
];

// Bike Taxi and Parcel fares. Admin-editable from the portal; never hardcoded
// in any client.
export const SEED_PRICING = [
  { service: "Bike Taxi", baseFare: 25, perKm: 8, platformFee: 4, partnerPayoutPercent: 80 },
  { service: "Parcel", baseFare: 35, perKm: 10, platformFee: 5, partnerPayoutPercent: 80 },
];

export const SEED_PRODUCTS = [
  { service: "Grocery", name: "Full Cream Milk 1L", description: "Fresh pasteurised milk", price: 68, stock: 80, rating: 4.7, eta: "25–35 min" },
  { service: "Grocery", name: "Premium Rice 5kg", description: "Everyday long-grain rice", price: 349, stock: 35, rating: 4.6, eta: "25–35 min" },
  { service: "Grocery", name: "Sunflower Oil 1L", description: "Refined cooking oil", price: 145, stock: 50, rating: 4.5, eta: "25–35 min" },
  { service: "Grocery", name: "Farm Eggs 12 pack", description: "Fresh graded eggs", price: 110, stock: 42, rating: 4.7, eta: "25–35 min" },
  { service: "Vegetables", name: "Tomatoes 1kg", description: "Farm-fresh local tomatoes", price: 48, stock: 65, rating: 4.6, eta: "20–30 min" },
  { service: "Vegetables", name: "Onions 1kg", description: "Fresh everyday onions", price: 42, stock: 70, rating: 4.5, eta: "20–30 min" },
  { service: "Vegetables", name: "Potatoes 1kg", description: "Cleaned fresh potatoes", price: 38, stock: 60, rating: 4.5, eta: "20–30 min" },
  { service: "Vegetables", name: "Green vegetables combo", description: "Seasonal leafy vegetable pack", price: 89, stock: 30, rating: 4.4, eta: "20–30 min" },
  { service: "Mart", name: "Mineral Water 1L", description: "Packaged drinking water", price: 20, stock: 100, rating: 4.8, eta: "15–25 min" },
  { service: "Mart", name: "Bread 400g", description: "Fresh sandwich bread", price: 45, stock: 45, rating: 4.5, eta: "15–25 min" },
  { service: "Mart", name: "Chocolate Ice Cream 700ml", description: "Family pack", price: 210, stock: 25, rating: 4.7, eta: "15–25 min" },
  { service: "Mart", name: "Laundry Detergent 1kg", description: "Machine and bucket wash", price: 185, stock: 34, rating: 4.4, eta: "15–25 min" },
];
