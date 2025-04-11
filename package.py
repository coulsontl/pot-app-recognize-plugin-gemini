import json
import zipfile
import os

def create_potext_package():
    # 读取info.json文件
    with open('info.json', 'r', encoding='utf-8') as f:
        info = json.load(f)
    
    # 提取id和icon
    plugin_id = info['id']
    icon_file = info['icon']
    
    # 输出信息
    print(f"正在打包插件: {plugin_id}")
    print(f"使用图标: {icon_file}")
    
    # 创建.potext文件（实际上是一个zip文件）
    output_filename = f"{plugin_id}.potext"
    
    # 检查输出文件是否已存在
    if os.path.exists(output_filename):
        print(f"警告: 文件 {output_filename} 已存在，将被覆盖")
    
    # 检查要打包的文件是否存在
    required_files = ['info.json', icon_file, 'main.js']
    for file in required_files:
        if not os.path.exists(file):
            print(f"错误: 文件 {file} 不存在!")
            return False
    
    # 创建zip文件 (使用'w'模式会自动覆盖已存在的文件)
    with zipfile.ZipFile(output_filename, 'w') as zipf:
        for file in required_files:
            zipf.write(file)
    
    print(f"打包完成: {output_filename}")
    return True

if __name__ == "__main__":
    create_potext_package() 