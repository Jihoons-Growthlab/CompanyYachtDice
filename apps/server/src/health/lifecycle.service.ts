import { Injectable } from '@nestjs/common';

/** 종료 절차 상태. draining 이 되면 /health/ready 가 503 을 반환해 LB 가 트래픽을 뺀다. */
@Injectable()
export class LifecycleService {
  private draining = false;
  startDraining() {
    this.draining = true;
  }
  get isDraining() {
    return this.draining;
  }
}
