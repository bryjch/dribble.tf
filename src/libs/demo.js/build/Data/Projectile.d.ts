import { Vector } from "./Vector";
export interface Projectile {
    type: keyof typeof ProjectileTypeMap | number;
    position: Vector;
    rotation: Vector;
    teamNumber: number;
}
export declare const ProjectileServerClassMap: {
    [key: string]: number;
};
export declare const ProjectileTypeMap: {
    [key: number]: string;
};
