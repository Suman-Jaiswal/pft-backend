export interface PaginatedResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}
