import { OrderRating } from "@/types";

export interface RatingServiceInterface {
  buildRating(input: Omit<OrderRating, "createdAt">): OrderRating;
}

class MockRatingService implements RatingServiceInterface {
  buildRating(input: Omit<OrderRating, "createdAt">): OrderRating {
    return { ...input, createdAt: new Date().toISOString() };
  }
}

export const ratingService: RatingServiceInterface = new MockRatingService();
