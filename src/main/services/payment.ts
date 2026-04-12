export class PaymentService {
  async createPixCharge(_saleId: number): Promise<{ qrCode: string }> {
    // TODO: Integrate Mercado Pago dynamic PIX API and return QR code payload.
    throw new Error("Payment service not implemented.");
  }

  async sendToPointMachine(_saleId: number): Promise<{ paymentId: string }> {
    // TODO: Integrate Mercado Pago Point API and return transaction identifier.
    throw new Error("Payment service not implemented.");
  }
}
