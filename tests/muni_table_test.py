"""tools/build_muni_table.py の解析を、手元の見本で確認する(外部通信なし)。"""
import importlib.util, os
spec = importlib.util.spec_from_file_location('bm', os.path.join(os.path.dirname(__file__), '..', 'tools', 'build_muni_table.py'))
bm = importlib.util.module_from_spec(spec); spec.loader.exec_module(bm)
SAMPLE = 'MUNI_ARRAY["14151"] = \'14,神奈川県,ｻｶﾞﾐﾊﾗ,相模原市　緑区\';\nMUNI_ARRAY["8201"] = \'8,茨城県,ﾐﾄ,水戸市\';\nMUNI_ARRAY["bad"] = \'x\';\nMUNI_ARRAY["1100"] = \'1,北海道,ｻｯﾎﾟﾛ\';'
t = bm.parse(SAMPLE)
assert t['14151'] == ['神奈川県', '相模原市　緑区'], t
assert t['08201'] == ['茨城県', '水戸市'], t          # 4桁のコードは5桁にそろえる
assert '01100' not in t and len(t) == 2, t              # 要素が足りない行は捨てる
print('全 4 件OK (build_muni_table.py)')
