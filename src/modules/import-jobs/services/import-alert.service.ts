import { Injectable, Logger } from '@nestjs/common'

@Injectable()
export class ImportAlertService {
  private readonly logger = new Logger(ImportAlertService.name)

  async sendFailureEmail(subject: string, message: string): Promise<void> {
    this.logger.warn(`[ImportAlert][Failure] ${subject} :: ${message}`)
  }

  async sendSpendCapAlert(subject: string, message: string): Promise<void> {
    this.logger.log(`[ImportAlert][SpendCap] ${subject} :: ${message}`)
  }
}
