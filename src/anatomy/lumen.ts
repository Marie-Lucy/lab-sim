/** Diameter profile sampled at a fixed spacing along a vessel. */
export class LumenProfile {
  readonly spacing: number;
  readonly reference: Float64Array;
  readonly diameter: Float64Array;

  constructor(
    readonly length: number,
    referenceAt: (arc: number) => number,
    nativeAt: (arc: number) => number = referenceAt,
    spacing = 0.25,
  ) {
    const n = Math.max(2, Math.ceil(length / spacing) + 1);
    this.spacing = length / (n - 1);
    this.reference = new Float64Array(n);
    this.diameter = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * this.spacing;
      this.reference[i] = referenceAt(s);
      this.diameter[i] = nativeAt(s);
    }
  }

  get count(): number {
    return this.diameter.length;
  }

  arcOf(i: number): number {
    return i * this.spacing;
  }

  private sample(arr: Float64Array, arc: number): number {
    const x = Math.min(this.count - 1, Math.max(0, arc / this.spacing));
    const i = Math.floor(x);
    const j = Math.min(this.count - 1, i + 1);
    return arr[i]! + (arr[j]! - arr[i]!) * (x - i);
  }

  diameterAt(arc: number): number {
    return this.sample(this.diameter, arc);
  }

  referenceAt(arc: number): number {
    return this.sample(this.reference, arc);
  }

  /** Smallest lumen diameter in [from, to] and where it is. */
  minimum(from = 0, to = this.length): { diameter: number; arc: number } {
    let best = Infinity;
    let arc = from;
    const i0 = Math.max(0, Math.floor(from / this.spacing));
    const i1 = Math.min(this.count - 1, Math.ceil(to / this.spacing));
    for (let i = i0; i <= i1; i++) {
      if (this.diameter[i]! < best) {
        best = this.diameter[i]!;
        arc = this.arcOf(i);
      }
    }
    return { diameter: best, arc };
  }
}
