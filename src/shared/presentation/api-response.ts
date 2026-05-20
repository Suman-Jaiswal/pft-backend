export interface ApiResponse<T> {
  success: boolean
  data: T
}

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data }
}
