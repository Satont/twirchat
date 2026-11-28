interface PaintStop {
  at: number
  color: string
}
export type CosmeticPaintLayer = { opacity: number } & (
  | { type: 'color'; color: string }
  | { type: 'linear'; angle: number; repeating: boolean; stops: PaintStop[] }
  | { type: 'radial'; shape: string; repeating: boolean; stops: PaintStop[] }
  | { type: 'image'; imageUrl: string }
)
export interface CosmeticPaint {
  id: string
  name: string
  layers: CosmeticPaintLayer[]
  shadows: Array<{ color: string; offsetX: number; offsetY: number; blur: number }>
}
