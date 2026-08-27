import { Router } from "express";
import { User } from "../models.js";
import { requireAuth, type AuthedRequest } from "../lib/auth.js";
import { ok, fail } from "../lib/http.js";
import { isValidCoordinate } from "../lib/geo.js";

export const customerRouter = Router();
customerRouter.use(requireAuth);

// Addresses are looked up fresh from the user document (never trusted from
// the request) so a customer can only ever read or edit their own.
const addressDTO = (a: any) => ({
  id: String(a._id),
  label: a.label,
  house: a.house,
  street: a.street,
  landmark: a.landmark,
  area: a.area,
  city: a.city,
  pincode: a.pincode,
  latitude: a.latitude,
  longitude: a.longitude,
  contactName: a.contactName,
  contactPhone: a.contactPhone,
  isDefault: a.isDefault,
});

customerRouter.get("/addresses", async (req: AuthedRequest, res) => {
  try {
    const user = await User.findById(req.user!._id, { addresses: 1 }).lean();
    res.json(ok({ addresses: (user?.addresses ?? []).map(addressDTO) }));
  } catch (e) {
    res.status(500).json(fail("ADDRESSES_UNAVAILABLE", e instanceof Error ? e.message : "Unable to load your addresses"));
  }
});

customerRouter.post("/addresses", async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    // Latitude/longitude are mandatory: they drive delivery-partner
    // assignment and live tracking, so an address without them is useless
    // for anything but display.
    if (!isValidCoordinate(body.latitude, body.longitude)) {
      return res.status(400).json(fail("INVALID_LOCATION", "Use current location or search for an address so we can pin its exact location."));
    }
    if (!["Home", "Work", "Other"].includes(body.label)) return res.status(400).json(fail("INVALID_LABEL", "Label must be Home, Work or Other."));

    const user = await User.findById(req.user!._id);
    if (!user) return res.status(404).json(fail("USER_NOT_FOUND", "Account not found"));

    const makeDefault = Boolean(body.isDefault) || user.addresses.length === 0;
    if (makeDefault) user.addresses.forEach((a: any) => (a.isDefault = false));

    user.addresses.push({
      label: body.label,
      house: body.house ?? "",
      street: body.street ?? "",
      landmark: body.landmark ?? "",
      area: body.area ?? "",
      city: body.city ?? "",
      pincode: body.pincode ?? "",
      latitude: body.latitude,
      longitude: body.longitude,
      contactName: body.contactName ?? user.name,
      contactPhone: body.contactPhone ?? user.phone ?? "",
      isDefault: makeDefault,
    } as any);
    await user.save();

    res.json(ok({ address: addressDTO(user.addresses[user.addresses.length - 1]) }, "Address added"));
  } catch (e) {
    res.status(500).json(fail("ADDRESS_CREATE_FAILED", e instanceof Error ? e.message : "Could not add this address"));
  }
});

customerRouter.patch("/addresses/:id", async (req: AuthedRequest, res) => {
  try {
    const user = await User.findById(req.user!._id);
    if (!user) return res.status(404).json(fail("USER_NOT_FOUND", "Account not found"));

    const address = (user.addresses as any).id(req.params.id);
    if (!address) return res.status(404).json(fail("ADDRESS_NOT_FOUND", "Address not found"));

    const body = req.body ?? {};
    if (body.latitude !== undefined || body.longitude !== undefined) {
      const lat = body.latitude ?? address.latitude;
      const lng = body.longitude ?? address.longitude;
      if (!isValidCoordinate(lat, lng)) return res.status(400).json(fail("INVALID_LOCATION", "That location isn't valid."));
      address.latitude = lat;
      address.longitude = lng;
    }
    for (const field of ["label", "house", "street", "landmark", "area", "city", "pincode", "contactName", "contactPhone"]) {
      if (body[field] !== undefined) (address as any)[field] = body[field];
    }
    if (body.isDefault === true) {
      user.addresses.forEach((a: any) => (a.isDefault = String(a._id) === String(address._id)));
    }

    await user.save();
    res.json(ok({ address: addressDTO(address) }, "Address updated"));
  } catch (e) {
    res.status(500).json(fail("ADDRESS_UPDATE_FAILED", e instanceof Error ? e.message : "Could not update this address"));
  }
});

customerRouter.delete("/addresses/:id", async (req: AuthedRequest, res) => {
  try {
    const user = await User.findById(req.user!._id);
    if (!user) return res.status(404).json(fail("USER_NOT_FOUND", "Account not found"));

    const address = (user.addresses as any).id(req.params.id);
    if (!address) return res.status(404).json(fail("ADDRESS_NOT_FOUND", "Address not found"));

    const wasDefault = address.isDefault;
    address.deleteOne();
    if (wasDefault && user.addresses.length) user.addresses[0].isDefault = true;

    await user.save();
    res.json(ok(null, "Address removed"));
  } catch (e) {
    res.status(500).json(fail("ADDRESS_DELETE_FAILED", e instanceof Error ? e.message : "Could not remove this address"));
  }
});
