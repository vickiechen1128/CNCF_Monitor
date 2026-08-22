import os
import yaml

# 基于本脚本所在位置定位同克隆的 .kimi，天然适配双文件夹隔离
THIS_DIR = os.path.dirname(os.path.abspath(__file__))
KIMI_DIR = os.path.join(THIS_DIR, ".kimi")
AGENTS_DIR = os.path.join(KIMI_DIR, "agents")

# 加载 YAML 配置文件
def load_agent_config(agent_name):
    yaml_path = os.path.join(AGENTS_DIR, f"{agent_name}.yaml")
    with open(yaml_path, 'r') as f:
        return yaml.safe_load(f)

# 示例：加载并打印 orchestrator 配置
if __name__ == "__main__":
    config = load_agent_config("orchestrator")
    print("Loaded agent config:", config)