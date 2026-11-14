import { AppError } from "@/lib/errors";

/** The stored, resolved part of an operation contradicts what it shows: it is not built. */
export const mismatch = (): never => {
	throw new AppError("ops.error.mismatch");
};
