"""
YOLO26 自定义训练脚本（模拟类游戏 UI 检测）。

数据集为 ultralytics 检测目录格式：
    dataset/
      images/   *.png
      labels/   *.txt   每行: classId cx cy w h（归一化）
      data.yaml         path/train/val/nc/names

SeerBrowserPro「标注」面板导出的数据集即此格式，可直接训练。

用法：
    python train.py --data <dataset>/data.yaml --weights yolo26n.pt --epochs 100 --imgsz 640
"""
import argparse


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True, help='data.yaml 路径')
    parser.add_argument('--weights', default='yolo26n.pt', help='起步权重（推荐 n/s 档）')
    parser.add_argument('--epochs', type=int, default=100)
    parser.add_argument('--imgsz', type=int, default=640)
    parser.add_argument('--batch', type=int, default=16)
    parser.add_argument('--device', default='cpu', help='cpu / 0(cuda)')
    parser.add_argument('--name', default='seer_game_ui')
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.weights)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        name=args.name,
        # YOLO26 训练建议：开启马赛克增强、小目标感知；数据量少时减小 batch
        patience=30,
        pretrained=True,
        plots=True,
    )
    print('[OK] 训练完成，权重位于 runs/detect/<name>/weights/best.pt')


if __name__ == '__main__':
    main()
