import { OrderRating } from "@/types";
import { apiPost } from "./apiClient";

export interface RatingServiceInterface {
  buildRating(input: Omit<OrderRating, "createdAt">): OrderRating;
  submitRating(rating: OrderRating): Promise<OrderRating>;
}

class ApiRatingService implements RatingServiceInterface {
  buildRating(input: Omit<OrderRating, "createdAt">): OrderRating {
    return { ...input, createdAt: new Date().toISOString() };
  }

  async submitRating(rating: OrderRating): Promise<OrderRating> {
    const data = await apiPost<{ rating: OrderRating }>("/api/v1/customer/ratings", rating);
    return data.rating;
  }
}

export const ratingService: RatingServiceInterface = new ApiRatingService();
