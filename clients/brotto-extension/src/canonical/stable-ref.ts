import type { AccessibilityNode, AXTuple } from "@brotto/brotto-action-schema";

export interface StableRefJSON {
  axPath: AXTuple[];
  attributeHash: string;
}

export class StableRef {
  constructor(
    public readonly axPath: AXTuple[],
    public readonly attributeHash: string,
    public readonly role: string,
    public readonly name: string,
  ) {}

  static fromAXNode(node: AccessibilityNode): StableRef {
    return new StableRef(node.axPath, node.attributeHash, node.role, node.name ?? "");
  }

  equals(other: StableRef): boolean {
    if (this.attributeHash !== other.attributeHash) return false;
    if (this.role !== other.role) return false;
    if (this.name !== other.name) return false;
    return this.sameAxPath(other.axPath);
  }

  private sameAxPath(other: AXTuple[]): boolean {
    if (this.axPath.length !== other.length) return false;
    for (let i = 0; i < this.axPath.length; i++) {
      const a = this.axPath[i];
      const b = other[i];
      if (a.role !== b.role || a.index !== b.index || (a.name ?? "") !== (b.name ?? "")) {
        return false;
      }
    }
    return true;
  }

  // Wire format key for StableRef transport (plan 2); full identity uses equals().
  toJSON(): StableRefJSON {
    return { axPath: this.axPath, attributeHash: this.attributeHash };
  }
}
